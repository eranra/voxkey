// Tests for the permission checks that keep VoxKey from failing silently.
//
// Background (bug found 2026-11-28, macOS): every reinstall of the ad-hoc signed app is a new
// identity for macOS, so the Accessibility and Microphone grants vanish. Typing and dictation
// then fail without any error. The app now checks both permissions and tells the user.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// src/permissions.js requires 'electron'; stub it before loading the module.
const openedUrls = [];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      shell: { openExternal: (url) => openedUrls.push(url) },
      systemPreferences: {}
    };
  }
  return originalLoad(request, parent, isMain);
};
const { askWithFocusedWindow, canDictate, canType, microphoneState, openPermissionSettings } = require('../../src/permissions');
Module._load = originalLoad;

describe('canType (the Accessibility permission for typing)', () => {
  it('is false on macOS when the app is not a trusted accessibility client', () => {
    assert.strictEqual(canType({ isTrustedAccessibilityClient: () => false }, 'darwin'), false);
  });

  it('is true on macOS when the app is trusted', () => {
    assert.strictEqual(canType({ isTrustedAccessibilityClient: () => true }, 'darwin'), true);
  });

  it('needs no permission on Windows', () => {
    assert.strictEqual(canType(null, 'win32'), true);
  });
});

describe('microphoneState', () => {
  it('reports the macOS TCC state', async () => {
    for (const status of ['granted', 'denied', 'restricted', 'not-determined']) {
      const state = await microphoneState({ prefs: { getMediaAccessStatus: () => status }, platform: 'darwin' });
      assert.strictEqual(state, status);
    }
  });

  it('maps unknown macOS values to unknown', async () => {
    const state = await microphoneState({ prefs: { getMediaAccessStatus: () => 'weird' }, platform: 'darwin' });
    assert.strictEqual(state, 'unknown');
  });

  it('reads the Windows global microphone switch from the registry', async () => {
    const fakeSpawn = (exe, args) => {
      assert.strictEqual(exe, 'reg');
      const child = {
        stdout: { on: (event, fn) => { if (event === 'data') fn(Buffer.from('    Value    REG_SZ    Allow')); } },
        on: (event, fn) => {
          if (event === 'exit') fn(0);
        }
      };
      return child;
    };
    const state = await microphoneState({ platform: 'win32', spawn: fakeSpawn });
    assert.strictEqual(state, 'granted');
  });

  it('reports denied when the Windows switch is off', async () => {
    const fakeSpawn = () => ({
      stdout: { on: (event, fn) => { if (event === 'data') fn(Buffer.from('    Value    REG_SZ    Deny')); } },
      on: (event, fn) => {
        if (event === 'exit') fn(0);
      }
    });
    const state = await microphoneState({ platform: 'win32', spawn: fakeSpawn });
    assert.strictEqual(state, 'denied');
  });

  it('stays unknown when the registry cannot be read', async () => {
    const fakeSpawn = () => ({
      stdout: { on: () => {} },
      on: (event, fn) => {
        if (event === 'error') fn(new Error('reg not found'));
      }
    });
    const state = await microphoneState({ platform: 'win32', spawn: fakeSpawn });
    assert.strictEqual(state, 'unknown');
  });

  it('stays unknown (not denied) when registry output is empty or non-zero', async () => {
    const fakeSpawn = () => ({
      stdout: { on: (event, fn) => {} },
      on: (event, fn) => {
        if (event === 'close') fn(0);
      }
    });
    const state = await microphoneState({ platform: 'win32', spawn: fakeSpawn });
    assert.strictEqual(state, 'unknown');
  });

  it('handles child close event with Allow properly', async () => {
    const fakeSpawn = () => ({
      stdout: { on: (event, fn) => { if (event === 'data') fn(Buffer.from('    Value    REG_SZ    Allow')); } },
      on: (event, fn) => {
        if (event === 'close') fn(0);
      }
    });
    const state = await microphoneState({ platform: 'win32', spawn: fakeSpawn });
    assert.strictEqual(state, 'granted');
  });
});

describe('canDictate', () => {
  it('allows granted, not-determined and unknown states', () => {
    assert.strictEqual(canDictate('granted'), true);
    assert.strictEqual(canDictate('not-determined'), true);
    assert.strictEqual(canDictate('unknown'), true);
  });

  it('blocks denied and restricted states, so the user is told instead of hearing silence', () => {
    assert.strictEqual(canDictate('denied'), false);
    assert.strictEqual(canDictate('restricted'), false);
  });
});

describe('openPermissionSettings', () => {
  it('asks macOS itself to open the Accessibility pane (the pane was renamed in newer releases)', () => {
    openedUrls.length = 0;
    const prompts = [];
    const prefs = { isTrustedAccessibilityClient: (prompt) => prompts.push(prompt) || true };
    assert.strictEqual(openPermissionSettings('accessibility', 'darwin', prefs), true);
    assert.deepStrictEqual(prompts, [true], 'the native prompt is requested');
    assert.deepStrictEqual(openedUrls, [], 'no hard-coded deep link is used');
  });

  it('falls back to the Accessibility deep link when the native prompt is unavailable', () => {
    openedUrls.length = 0;
    assert.strictEqual(openPermissionSettings('accessibility', 'darwin', {}), true);
    assert.deepStrictEqual(openedUrls, ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility']);
  });

  it('opens the macOS microphone pane', () => {
    openedUrls.length = 0;
    assert.strictEqual(openPermissionSettings('microphone', 'darwin'), true);
    assert.deepStrictEqual(openedUrls, ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone']);
  });

  it('knows no typing pane (Windows needs none) and no unknown permissions', () => {
    openedUrls.length = 0;
    assert.strictEqual(openPermissionSettings('accessibility', 'win32'), false);
    assert.strictEqual(openPermissionSettings('camera', 'darwin'), false);
    assert.deepStrictEqual(openedUrls, []);
  });

  it('opens the Windows microphone privacy page', () => {
    openedUrls.length = 0;
    assert.strictEqual(openPermissionSettings('microphone', 'win32'), true);
    assert.deepStrictEqual(openedUrls, ['ms-settings:privacy-microphone']);
  });
});

describe('askWithFocusedWindow (macOS shows permission prompts only for an active window)', () => {
  function fakeWindow({ focusable = false, destroyed = false } = {}) {
    const calls = [];
    const win = {
      isDestroyed: () => destroyed,
      isFocusable: () => calls.filter((c) => c.op === 'setFocusable').at(-1)?.value ?? focusable,
      setFocusable: (value) => calls.push({ op: 'setFocusable', value }),
      show: () => calls.push({ op: 'show' }),
      focus: () => calls.push({ op: 'focus' }),
      blur: () => calls.push({ op: 'blur' })
    };
    return { win, calls };
  }

  it('focuses the window around the request and restores the not-focusable state', async () => {
    const { win, calls } = fakeWindow();
    const result = await askWithFocusedWindow(() => win, async () => 'granted');
    assert.strictEqual(result, 'granted');
    assert.ok(calls.some((c) => c.op === 'setFocusable' && c.value === true), 'takes focus for the prompt');
    assert.strictEqual(calls.at(-1).op, 'blur', 'hands focus back afterwards');
    assert.strictEqual(calls.filter((c) => c.op === 'setFocusable').at(-1).value, false, 'restored to not focusable');
  });

  it('serializes concurrent requests, so the second cannot capture the temporary focusable state', async () => {
    const { win, calls } = fakeWindow();
    let releaseFirst;
    const firstGate = new Promise((r) => (releaseFirst = r));
    const first = askWithFocusedWindow(() => win, () => new Promise((r) => firstGate.then(() => r('granted'))));
    const second = askWithFocusedWindow(() => win, async () => 'granted');
    await new Promise((r) => setTimeout(r, 10));
    releaseFirst();
    assert.deepStrictEqual(await Promise.all([first, second]), ['granted', 'granted']);
    // After both, the last setFocusable restores the normal not-focusable state.
    assert.strictEqual(calls.filter((c) => c.op === 'setFocusable').at(-1).value, false);
  });

  it('restores the window even when the request fails, and works without a window', async () => {
    const { win, calls } = fakeWindow();
    await assert.rejects(askWithFocusedWindow(() => win, () => Promise.reject(new Error('no TCC'))), /no TCC/);
    assert.strictEqual(calls.filter((c) => c.op === 'setFocusable').at(-1).value, false, 'restored');
    const result = await askWithFocusedWindow(() => null, async () => 'unavailable');
    assert.strictEqual(result, 'unavailable');
  });
});

describe('the keyboard window shows the warnings (wiring)', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('app.js reacts to permission updates and can open the settings pane', () => {
    const app = read('renderer/app.js');
    assert.match(app, /api\.onPermissions\(/);
    assert.match(app, /applyPermissions/);
    assert.match(app, /openPermissionSettings/);
  });

  it('index.html has the warning bar and preload exposes its API', () => {
    const html = read('renderer/index.html');
    assert.match(html, /id="permission-warning"/);
    assert.match(html, /id="permission-warning-btn"/);
    const preload = read('renderer/preload.js');
    assert.match(preload, /onPermissions/);
    assert.match(preload, /openPermissionSettings/);
  });
});
