const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_SETTINGS, normalizeSettings, SettingsStore } = require('../../src/store');

describe('settings', () => {
  it('defaults: check for updates, English, toggle microphone', () => {
    assert.deepStrictEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
    assert.strictEqual(DEFAULT_SETTINGS.checkForUpdates, true);
    assert.strictEqual(DEFAULT_SETTINGS.voiceMode, 'toggle');
  });

  it('drops wrong types and unsafe values', () => {
    const s = normalizeSettings({ checkForUpdates: 'yes', lastAnnouncedVersion: '<script>', language: '../../etc', extra: 1 });
    assert.deepStrictEqual(s, { ...DEFAULT_SETTINGS });
    assert.strictEqual(normalizeSettings({ lastAnnouncedVersion: '0.3.0' }).lastAnnouncedVersion, '0.3.0');
    assert.strictEqual(normalizeSettings({ language: 'he-IL' }).language, 'he-IL');
  });

  it('keeps a valid microphone mode and replaces anything else with the default', () => {
    assert.strictEqual(normalizeSettings({ voiceMode: 'until-silence' }).voiceMode, 'until-silence');
    assert.strictEqual(normalizeSettings({ voiceMode: 'toggle' }).voiceMode, 'toggle');
    assert.strictEqual(normalizeSettings({ voiceMode: 'hold' }).voiceMode, 'hold');
    for (const bad of ['hold-to-talk', '', null, 1, {}, []]) {
      assert.strictEqual(normalizeSettings({ voiceMode: bad }).voiceMode, 'toggle', String(bad));
    }
  });

  it('keeps the start-with-system flag, defaulting to off', () => {
    assert.strictEqual(normalizeSettings({ startWithSystem: true }).startWithSystem, true);
    assert.strictEqual(normalizeSettings({ startWithSystem: false }).startWithSystem, false);
    for (const bad of ['yes', 1, null, {}]) {
      assert.strictEqual(normalizeSettings({ startWithSystem: bad }).startWithSystem, false, String(bad));
    }
  });

  it('keeps a valid voice shortcut and replaces anything else with the default', () => {
    assert.strictEqual(normalizeSettings({ voiceShortcut: 'rightOption' }).voiceShortcut, 'rightOption');
    assert.strictEqual(normalizeSettings({ voiceShortcut: 'f6' }).voiceShortcut, 'f6');
    for (const bad of ['F9', 'right-option', '', null, 1, {}, []]) {
      assert.strictEqual(normalizeSettings({ voiceShortcut: bad }).voiceShortcut, 'f8', String(bad));
    }
  });

  it('saves and loads from disk; a broken file gives the defaults', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voxkey-store-'));
    const file = path.join(dir, 'nested', 'settings.json');
    try {
      const store = new SettingsStore(file);
      store.update({ checkForUpdates: false, language: 'fr-FR', voiceMode: 'until-silence', voiceShortcut: 'f6' });
      assert.deepStrictEqual(
        new SettingsStore(file).get(),
        { ...DEFAULT_SETTINGS, checkForUpdates: false, language: 'fr-FR', voiceMode: 'until-silence', voiceShortcut: 'f6' }
      );
      assert.strictEqual(fs.existsSync(`${file}.tmp`), false);

      fs.writeFileSync(file, '{ not json');
      assert.deepStrictEqual(new SettingsStore(file).get(), { ...DEFAULT_SETTINGS });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('get() returns a copy', () => {
    const store = new SettingsStore(path.join(os.tmpdir(), 'voxkey-missing', 'none.json'));
    store.get().language = 'xx';
    assert.strictEqual(store.get().language, 'en-US');
  });
});
