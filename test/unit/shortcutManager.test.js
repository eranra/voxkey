// Tests for the configurable voice activation shortcut and hold-to-talk.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// src/shortcutManager.js requires 'electron' lazily; stub it before loading.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return { globalShortcut: { register() {}, unregister() {}, isRegistered() { return false; } } };
  }
  return originalLoad(request, parent, isMain);
};
const { SHORTCUTS, ShortcutManager, shortcutChoices, KEYSTATE_HELPERS } = require('../../src/shortcutManager');
Module._load = originalLoad;

function fakeGlobalShortcut() {
  const registered = new Map();
  return {
    registered,
    register: (accelerator, handler) => {
      registered.set(accelerator, handler);
      return true;
    },
    unregister: (accelerator) => registered.delete(accelerator),
    isRegistered: (accelerator) => registered.has(accelerator),
    fire: (accelerator) => registered.get(accelerator)()
  };
}

function fakeHelper() {
  const child = {
    stdout: {
      handlers: [],
      on(event, fn) {
        if (event === 'data') this.handlers.push(fn);
      },
      emit(line) {
        for (const fn of this.handlers) fn(Buffer.from(line + '\n'));
      }
    },
    killed: false,
    kill() {
      this.killed = true;
      if (this.onExit) this.onExit();
    },
    on(event, fn) {
      if (event === 'exit') this.onExit = fn;
      // 'error' needs no behavior in the tests.
    }
  };
  return child;
}

function makeManager({ platform = 'darwin', fileExists = () => true } = {}) {
  const gs = fakeGlobalShortcut();
  const helpers = [];
  const mgr = new ShortcutManager({
    globalShortcut: gs,
    spawn: (cmd) => {
      const child = fakeHelper();
      helpers.push(child);
      return child;
    },
    platform,
    fileExists
  });
  return { mgr, gs, helpers };
}

describe('ShortcutManager', () => {
  it('registers a plain global shortcut in toggle mode, exactly like before', () => {
    const { mgr, gs, helpers } = makeManager();
    const activations = [];
    mgr.onActivate = () => activations.push(1);
    mgr.configure('f8', 'toggle');
    assert.deepStrictEqual([...gs.registered.keys()], ['F8'], 'F8 is registered with Electron');
    assert.strictEqual(helpers.length, 0, 'no key-state helper for the classic path');
    gs.fire('F8');
    assert.strictEqual(activations.length, 1);
  });

  it('runs the helper for hold mode and reports the release', () => {
    const { mgr, gs, helpers } = makeManager();
    const events = [];
    mgr.onActivate = () => events.push('down');
    mgr.onRelease = () => events.push('up');
    mgr.configure('f8', 'hold');
    assert.strictEqual(gs.registered.size, 0, 'no global shortcut in hold mode');
    assert.strictEqual(helpers.length, 1, 'the key-state helper runs');
    helpers[0].stdout.emit('down f8');
    helpers[0].stdout.emit('up f8');
    assert.deepStrictEqual(events, ['down', 'up']);
  });

  it('right Option is a helper shortcut; a hold works through it', () => {
    const { mgr, gs, helpers } = makeManager();
    const events = [];
    mgr.onActivate = () => events.push('down');
    mgr.onRelease = () => events.push('up');
    mgr.configure('rightOption', 'hold');
    assert.strictEqual(gs.registered.size, 0, 'a bare modifier can never be a global shortcut');
    helpers[0].stdout.emit('down rightoption');
    helpers[0].stdout.emit('up rightoption');
    helpers[0].stdout.emit('down f6'); // some other key: ignored
    assert.deepStrictEqual(events, ['down', 'up']);
  });

  it('in toggle mode a held polled key activates once, not on every poll', () => {
    const { mgr, helpers } = makeManager();
    const activations = [];
    mgr.onActivate = () => activations.push(1);
    mgr.configure('rightOption', 'toggle');
    helpers[0].stdout.emit('down rightoption');
    helpers[0].stdout.emit('down rightoption'); // the key is simply still down
    helpers[0].stdout.emit('up rightoption');
    helpers[0].stdout.emit('down rightoption'); // pressed again: a new activation
    assert.strictEqual(activations.length, 2);
  });

  it('changing the shortcut unregisters the old one', () => {
    const { mgr, gs, helpers } = makeManager();
    mgr.configure('f8', 'toggle');
    assert.ok(gs.isRegistered('F8'));
    mgr.configure('ctrlShiftSpace', 'toggle');
    assert.ok(!gs.isRegistered('F8'));
    assert.ok(gs.isRegistered('CommandOrControl+Shift+Space'));
    assert.strictEqual(helpers.length, 0);
  });

  it('falls back to a global shortcut when the helper binary is missing', () => {
    const { mgr, gs, helpers } = makeManager({ fileExists: () => false });
    mgr.onActivate = () => {};
    mgr.configure('rightOption', 'hold');
    // Right Option has no accelerator, so nothing can be registered; it must not crash.
    assert.strictEqual(gs.registered.size, 0);
    // An accelerator shortcut in hold mode falls back to press-only activation.
    mgr.configure('f8', 'hold');
    assert.deepStrictEqual([...gs.registered.keys()], ['F8'], 'hold degrades to press-to-talk');
  });

  it('windows runs the key-state helper for hold mode, with the shortcut suppressed', () => {
    const spawns = [];
    const gs = fakeGlobalShortcut();
    const mgr = new ShortcutManager({
      globalShortcut: gs,
      spawn: (cmd, args) => {
        const child = fakeHelper();
        spawns.push({ cmd, args, child });
        return child;
      },
      platform: 'win32',
      fileExists: () => true
    });
    const events = [];
    mgr.onActivate = () => events.push('down');
    mgr.onRelease = () => events.push('up');
    mgr.configure('f8', 'hold');
    assert.strictEqual(gs.registered.size, 0);
    assert.strictEqual(spawns.length, 1);
    assert.strictEqual(spawns[0].cmd, KEYSTATE_HELPERS.win32, 'the Windows helper binary');
    assert.deepStrictEqual(spawns[0].args, ['--suppress', 'f8'], 'the shortcut key does not reach other apps');
    spawns[0].child.stdout.emit('down f8');
    spawns[0].child.stdout.emit('up f8');
    assert.deepStrictEqual(events, ['down', 'up']);
  });

  it('windows offers Right Alt as the hold shortcut, macOS does not', () => {
    const { mgr, helpers } = makeManager({ platform: 'win32' });
    mgr.onActivate = () => {};
    mgr.configure('rightAlt', 'hold');
    assert.strictEqual(helpers.length, 1);
    const mac = shortcutChoices('darwin').map((c) => c.key);
    assert.ok(!mac.includes('rightAlt'));
    assert.ok(shortcutChoices('win32').map((c) => c.key).includes('rightAlt'));
  });

  it('a platform without a helper never runs one', () => {
    const { mgr, helpers } = makeManager({ platform: 'linux' });
    mgr.configure('f8', 'hold');
    assert.strictEqual(helpers.length, 0);
  });

  it('stop() cleans everything up', () => {
    const { mgr, gs, helpers } = makeManager();
    mgr.configure('rightOption', 'hold');
    mgr.stop();
    assert.ok(helpers[0].killed, 'the helper is stopped');
  });
});

describe('shortcutChoices', () => {
  it('offers Right Option and Right Command only on macOS', () => {
    const mac = shortcutChoices('darwin').map((c) => c.key);
    const win = shortcutChoices('win32').map((c) => c.key);
    assert.ok(mac.includes('rightOption') && mac.includes('rightCommand'));
    assert.ok(!win.includes('rightOption') && !win.includes('rightCommand'));
    assert.ok(win.includes('f8'));
  });
});

describe('keystate helper source (wiring)', () => {
  it('watches the keys that ShortcutManager knows about, on both systems', () => {
    const mac = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'keystate.swift'), 'utf8');
    const win = fs.readFileSync(path.join(__dirname, '..', '..', 'native', 'keystate.cs'), 'utf8');
    for (const def of Object.values(SHORTCUTS)) {
      if (!def.keyCode) continue;
      const source = def.platform === 'win32' ? win : mac;
      assert.ok(source.includes(`"${def.keyCode}"`), `${def.keyCode} is watched on ${def.platform || 'darwin'}`);
    }
  });

  it('the helper output protocol is down/up lines', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'keystate.swift'), 'utf8');
    assert.match(source, /down \\\(name\)/);
    assert.match(source, /up \\\(name\)/);
  });
});
