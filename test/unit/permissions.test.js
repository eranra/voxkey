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
const { canDictate, canType, microphoneState, openPermissionSettings } = require('../../src/permissions');
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
