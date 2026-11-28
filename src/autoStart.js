/**
 * Starts VoxKey when the user signs in to the system (macOS login items, Windows registry),
 * saved with the other settings. Dictation itself never starts on its own: the app always
 * launches idle, and every setting — language, microphone mode, shortcut, autostart — is
 * restored from disk.
 *
 * The module only wraps Electron's app.setLoginItemSettings / getLoginItemSettings, so it can
 * be tested with a fake `app`.
 */
const AUTO_START_SETTING = 'startWithSystem';

/** Applies the stored setting to the system. Called once at startup and after each change. */
function applyAutoStart(app, enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    return true;
  } catch (err) {
    console.warn('[AutoStart] Could not change the login item:', err.message);
    return false;
  }
}

/** Reads what the system currently has, so the menu can show the truth. */
function systemAutoStartEnabled(app) {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch (err) {
    return false;
  }
}

module.exports = { AUTO_START_SETTING, applyAutoStart, systemAutoStartEnabled };
