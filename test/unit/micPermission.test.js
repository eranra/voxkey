// Tests for the microphone permission request (macOS): the speech bridge Chrome that VoxKey
// starts attributes its microphone use to VoxKey, so VoxKey itself must hold the permission.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// src/micPermission.js requires 'electron', which is not available under plain node.
// Stub it before loading the module.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return { systemPreferences: { getMediaAccessStatus() {}, askForMediaAccess() {} } };
  }
  return originalLoad(request, parent, isMain);
};
const { requestMicrophoneAccess } = require('../../src/micPermission');
Module._load = originalLoad;

function fakePrefs(status, askResult = true) {
  const calls = { asked: 0 };
  return {
    calls,
    getMediaAccessStatus: () => status,
    askForMediaAccess: async () => {
      calls.asked++;
      return askResult;
    }
  };
}

describe('microphone permission (macOS)', () => {
  it('asks when the state is not determined', async () => {
    const prefs = fakePrefs('not-determined');
    assert.strictEqual(await requestMicrophoneAccess(prefs, 'darwin'), 'granted');
    assert.strictEqual(prefs.calls.asked, 1, 'the system prompt was requested');
  });

  it('does not ask again once granted', async () => {
    const prefs = fakePrefs('granted');
    assert.strictEqual(await requestMicrophoneAccess(prefs, 'darwin'), 'granted');
    assert.strictEqual(prefs.calls.asked, 0);
  });

  it('does not ask when access was denied; the user must change it in System Settings', async () => {
    const prefs = fakePrefs('denied');
    assert.strictEqual(await requestMicrophoneAccess(prefs, 'darwin'), 'denied');
    assert.strictEqual(prefs.calls.asked, 0, 'a denied state gets no prompt');
  });

  it('reports the refusal when the user declines the prompt', async () => {
    const prefs = fakePrefs('not-determined', false);
    assert.strictEqual(await requestMicrophoneAccess(prefs, 'darwin'), 'denied');
    assert.strictEqual(prefs.calls.asked, 1);
  });

  it('is a no-op outside macOS', async () => {
    const prefs = fakePrefs('not-determined');
    assert.strictEqual(await requestMicrophoneAccess(prefs, 'win32'), 'unavailable');
    assert.strictEqual(prefs.calls.asked, 0);
  });
});
