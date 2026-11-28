// Tests for the start-with-system setting (login items on macOS, registry on Windows).
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { AUTO_START_SETTING, applyAutoStart, systemAutoStartEnabled } = require('../../src/autoStart');

function fakeApp() {
  const calls = [];
  let openAtLogin = false;
  return {
    calls,
    setLoginItemSettings(settings) {
      calls.push(['set', settings]);
      openAtLogin = Boolean(settings.openAtLogin);
    },
    getLoginItemSettings() {
      calls.push(['get']);
      return { openAtLogin };
    }
  };
}

describe('applyAutoStart', () => {
  it('writes the setting to the system login items', () => {
    const app = fakeApp();
    assert.strictEqual(applyAutoStart(app, true), true);
    assert.deepStrictEqual(app.calls[0], ['set', { openAtLogin: true }]);
    applyAutoStart(app, false);
    assert.deepStrictEqual(app.calls[1], ['set', { openAtLogin: false }]);
  });

  it('survives a failing system call without throwing', () => {
    const app = {
      setLoginItemSettings() {
        throw new Error('locked registry');
      }
    };
    assert.strictEqual(applyAutoStart(app, true), false);
    assert.strictEqual(systemAutoStartEnabled(app), false);
  });

  it('reads the current system state', () => {
    const app = fakeApp();
    applyAutoStart(app, true);
    assert.strictEqual(systemAutoStartEnabled(app), true);
    applyAutoStart(app, false);
    assert.strictEqual(systemAutoStartEnabled(app), false);
  });

  it('the setting key matches the store field', () => {
    assert.strictEqual(AUTO_START_SETTING, 'startWithSystem');
  });
});
