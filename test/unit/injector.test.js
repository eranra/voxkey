const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { InjectorManager, ACTIVATE_SETTLE_MS, CLIPBOARD_RESTORE_MS, appleScriptString, macKeyScript, macTextPlan } = require('../../src/injectorManager');

/** A fake spawn: each osascript "runs" for `ms` milliseconds; finished scripts are recorded in order. */
function fakeSpawn(log, ms = 5) {
  return (cmd, args) => {
    const child = new EventEmitter();
    const delay = args && args[1] && args[1].includes('slow') ? ms * 6 : ms;
    setTimeout(() => {
      log.push(args[1]);
      child.emit('exit', 0);
    }, delay);
    return child;
  };
}

describe('macOS AppleScript building', () => {
  it('escapes quotes and backslashes', () => {
    assert.strictEqual(appleScriptString('say "hi" \\o/'), '"say \\"hi\\" \\\\o/"');
  });

  it('special keys use key codes; unknown keys are ignored', () => {
    assert.strictEqual(macKeyScript('BACKSPACE'), 'tell application "System Events" to key code 51');
    assert.strictEqual(macKeyScript('enter'), 'tell application "System Events" to key code 36');
    assert.strictEqual(macKeyScript('ESCAPE'), 'tell application "System Events" to key code 53');
    assert.strictEqual(macKeyScript('F13'), null);
  });

  it('types ASCII directly and pastes everything else', () => {
    assert.strictEqual(macTextPlan('Hello, world!').method, 'keystroke');
    assert.strictEqual(macTextPlan('שלום').method, 'paste');
    assert.strictEqual(macTextPlan('Привет').method, 'paste');
    assert.strictEqual(macTextPlan('a\nb').method, 'paste');
  });
});

describe('InjectorManager on macOS', () => {
  it('runs commands one at a time, in the order they were sent', async () => {
    const log = [];
    const mgr = new InjectorManager('/none', { platform: 'darwin', spawn: fakeSpawn(log) });
    mgr.sendText('slow');
    mgr.sendKey('BACKSPACE');
    await mgr.sendText('b');
    assert.deepStrictEqual(log, [
      'tell application "System Events" to keystroke "slow"',
      'tell application "System Events" to key code 51',
      'tell application "System Events" to keystroke "b"'
    ]);
  });

  it('reports a failing osascript (missing Accessibility permission) instead of failing silently', async () => {
    const errors = [];
    const spawn = (cmd, args) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => {
        child.stderr.emit('data', Buffer.from('36:49: execution error: osascript is not allowed to send keystrokes. (1002)'));
        child.emit('exit', 1);
      }, 5);
      return child;
    };
    const mgr = new InjectorManager('/none', { platform: 'darwin', spawn, onMacError: (detail) => errors.push(detail) });
    await mgr.sendText('hello');
    assert.strictEqual(errors.length, 1, 'the failure is reported');
    assert.match(errors[0], /not allowed to send keystrokes/);
  });

  it('does not report a successful command, or one killed by a signal', async () => {
    const errors = [];
    const spawn = (cmd, args) => {
      const child = new EventEmitter();
      const killed = args[1].includes('killme');
      setTimeout(() => child.emit('exit', killed ? null : 0), 5);
      return child;
    };
    const mgr = new InjectorManager('/none', { platform: 'darwin', spawn, onMacError: (detail) => errors.push(detail) });
    await mgr.sendText('fine');
    await mgr.sendText('killme');
    assert.deepStrictEqual(errors, []);
  });

  it('typing goes back to the app the user was in: the tracker feeds the target, the script activates it', async () => {
    // Clicking the keyboard window activates VoxKey on newer macOS even though the window is
    // not focusable; without re-activating the user's app, the keys land in the keyboard.
    let trackerChild = null;
    const spawn = (cmd, args) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      if (args[1] && args[1].includes('repeat')) {
        trackerChild = child; // the frontmost tracker, runs forever
      } else {
        setTimeout(() => child.emit('exit', 0), 5); // a typing command
      }
      return child;
    };
    const mgr = new InjectorManager('/none', { platform: 'darwin', spawn, appName: 'VoxKey' });
    mgr.start();
    assert.ok(trackerChild, 'the tracker started');

    // The user works in TextEdit, then clicks the keyboard (VoxKey becomes frontmost).
    trackerChild.stderr.emit('data', Buffer.from('TextEdit\n'));
    trackerChild.stderr.emit('data', Buffer.from('VoxKey\n'));
    assert.strictEqual(mgr.targetApp, 'TextEdit', 'the last non-VoxKey app is the typing target');
    await mgr.sendText('hi');

    const wrapped = mgr.withTargetApp('tell application "System Events" to keystroke "hi"');
    assert.ok(wrapped.startsWith('tell application "System Events" to set frontmost of process "TextEdit" to true'), wrapped);
    assert.ok(wrapped.includes('delay'), 'waits for the activation to settle');
    assert.ok(wrapped.includes('keystroke "hi"'), 'runs the original script');

    // Without a known target the script is left alone.
    mgr.targetApp = null;
    assert.strictEqual(mgr.withTargetApp('plain'), 'plain');
    mgr.stop();
  });

  it('pastes non-ASCII text and puts the old clipboard text back', async () => {
    const log = [];
    let clip = 'old';
    const clipboard = { readText: () => clip, writeText: (t) => (clip = t) };
    const mgr = new InjectorManager('/none', {
      platform: 'darwin',
      clipboard,
      clipboardRestoreMs: 20,
      spawn: fakeSpawn(log)
    });
    const seen = [];
    const spawn = mgr.spawn;
    mgr.spawn = (cmd, args) => {
      seen.push(clip);
      return spawn(cmd, args);
    };
    await mgr.pasteMac('שלום ', macTextPlan('שלום ').script);
    assert.deepStrictEqual(seen, ['שלום ']);
    assert.deepStrictEqual(log, ['tell application "System Events" to keystroke "v" using command down']);
    assert.strictEqual(clip, 'old');
  });

  it('gives a slow application time to process the paste before the clipboard is restored', () => {
    // Regression (found 2026-11-28): with a short restore, busy applications (browsers,
    // Electron apps) processed the Cmd+V only after the old clipboard content was back, so
    // Hebrew and other non-ASCII dictation pasted nothing while English kept working.
    assert.ok(
      CLIPBOARD_RESTORE_MS >= 1000,
      `restore after ${CLIPBOARD_RESTORE_MS} ms is too fast for slow applications`
    );
  });

  it('does not overwrite the clipboard if something else changed it', async () => {
    let clip = 'old';
    const clipboard = { readText: () => clip, writeText: (t) => (clip = t) };
    const mgr = new InjectorManager('/none', {
      platform: 'darwin',
      clipboard,
      clipboardRestoreMs: 20,
      spawn: () => {
        const child = new EventEmitter();
        setTimeout(() => {
          clip = 'user copied this';
          child.emit('exit', 0);
        }, 5);
        return child;
      }
    });
    await mgr.pasteMac('日本', 'paste');
    assert.strictEqual(clip, 'user copied this');
  });

  it('a failing osascript does not block later commands', async () => {
    let n = 0;
    const mgr = new InjectorManager('/none', {
      platform: 'darwin',
      spawn: () => {
        const child = new EventEmitter();
        n++;
        setTimeout(() => (n === 1 ? child.emit('error', new Error('boom')) : child.emit('exit', 0)), 1);
        return child;
      }
    });
    mgr.sendKey('ENTER');
    await mgr.sendKey('TAB');
    assert.strictEqual(n, 2);
  });

  it('does not start the Windows helper on macOS', () => {
    const mgr = new InjectorManager('/none', { platform: 'darwin', spawn: () => assert.fail('no spawn') });
    assert.strictEqual(mgr.start(), false);
    assert.strictEqual(mgr.isAlive(), false);
  });
});

describe('InjectorManager on Windows', () => {
  it('sends TEXT/KEY/HIDE_BRIDGE lines to the running helper', () => {
    const lines = [];
    const mgr = new InjectorManager('C:\\injector.exe', { platform: 'win32', spawn: () => assert.fail('no spawn') });
    mgr.process = { stdin: { writable: true, write: (l) => lines.push(l) }, killed: false };
    mgr.sendText('hi');
    mgr.sendKey('ENTER');
    mgr.hideBridgeWindow();
    assert.deepStrictEqual(lines, ['TEXT:hi\n', 'KEY:ENTER\n', 'HIDE_BRIDGE\n']);
  });

  it('keeps each text on one command line', () => {
    const lines = [];
    const mgr = new InjectorManager('C:\\injector.exe', { platform: 'win32', spawn: () => assert.fail('no spawn') });
    mgr.process = { stdin: { writable: true, write: (l) => lines.push(l) }, killed: false };
    mgr.sendText('one\r\ntwo\nשלום');
    assert.deepStrictEqual(lines, ['TEXT:one two שלום\n']);
  });

  it('runs the helper once per command when it is not running', () => {
    const calls = [];
    const mgr = new InjectorManager('C:\\injector.exe', { platform: 'win32', spawn: (exe, args) => calls.push([exe, args]) });
    mgr.sendText('hi');
    mgr.sendKey('TAB');
    assert.deepStrictEqual(calls, [
      ['C:\\injector.exe', ['--text', 'hi']],
      ['C:\\injector.exe', ['--key', 'TAB']]
    ]);
  });
});
