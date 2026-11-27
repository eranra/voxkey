const fs = require('fs');
const path = require('path');
const { parseVersion } = require('./update');

const DEFAULT_SETTINGS = Object.freeze({
  /** Check GitHub for new versions on start and every few hours. */
  checkForUpdates: true,
  /** The newest version the user was already told about, so automatic checks tell only once. */
  lastAnnouncedVersion: null,
  /** Speech recognition language, for example "en-US". */
  language: 'en-US',
  /** How the microphone behaves: 'toggle' stays on until pressed again, 'until-silence' stops by itself. */
  voiceMode: 'toggle'
});

/** The two microphone behaviors. */
const VOICE_MODES = ['toggle', 'until-silence'];

/** Returns valid settings from any saved value. Unknown keys and wrong types fall back to the defaults. */
function normalizeSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    checkForUpdates: typeof value.checkForUpdates === 'boolean' ? value.checkForUpdates : DEFAULT_SETTINGS.checkForUpdates,
    lastAnnouncedVersion: parseVersion(value.lastAnnouncedVersion) ? value.lastAnnouncedVersion : null,
    language: typeof value.language === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(value.language)
      ? value.language
      : DEFAULT_SETTINGS.language,
    voiceMode: VOICE_MODES.includes(value.voiceMode) ? value.voiceMode : DEFAULT_SETTINGS.voiceMode
  };
}

/** Settings saved as JSON in the app's user data folder. */
class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.settings = this.load();
  }

  load() {
    try {
      return normalizeSettings(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')));
    } catch {
      return normalizeSettings(null);
    }
  }

  get() {
    return { ...this.settings };
  }

  update(patch) {
    this.settings = normalizeSettings({ ...this.settings, ...(patch || {}) });
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      // Write to a temporary file first, so a crash never leaves a half-written settings file.
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.warn('[SettingsStore] Could not save settings:', err.message);
    }
    return this.get();
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  VOICE_MODES,
  normalizeSettings,
  SettingsStore
};
