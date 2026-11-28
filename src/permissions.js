const { shell, systemPreferences } = require('electron');
const { spawn } = require('child_process');

/**
 * Opens the macOS pane or Windows settings page where this permission lives.
 *
 * For Accessibility the native prompt is used (AXIsProcessTrustedWithOptions): macOS itself opens
 * the right pane on every version. Newer releases renamed and reorganized the privacy panes, so a
 * hard-coded deep link can land somewhere the user cannot find.
 */
function openPermissionSettings(permission, platform = process.platform, prefs = systemPreferences) {
  if (platform === 'darwin') {
    if (permission === 'accessibility') {
      if (prefs && typeof prefs.isTrustedAccessibilityClient === 'function') {
        prefs.isTrustedAccessibilityClient(true);
        return true;
      }
      void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      return true;
    }
    if (permission === 'microphone') {
      void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
      return true;
    }
    return false;
  }
  if (platform === 'win32' && permission === 'microphone') {
    void shell.openExternal('ms-settings:privacy-microphone');
    return true;
  }
  return false;
}

/**
 * Whether VoxKey may type into other apps.
 * - macOS: the Accessibility permission (AppleScript keystrokes through System Events).
 * - Windows: the native helper sends keystrokes through SendInput; no permission is needed.
 *
 * @param prefs injected for tests; defaults to Electron's systemPreferences
 * @param platform injected for tests; defaults to the real platform
 */
function canType(prefs = systemPreferences, platform = process.platform) {
  if (platform !== 'darwin') return true;
  if (!prefs || typeof prefs.isTrustedAccessibilityClient !== 'function') return true;
  return prefs.isTrustedAccessibilityClient(false);
}

/**
 * The microphone permission state, normalized to 'granted' | 'denied' | 'not-determined' |
 * 'unknown'. On Windows the global "Let desktop apps access your microphone" switch is read
 * from the registry; on macOS Electron reports the TCC state directly.
 *
 * @param deps injected for tests: { prefs, platform, spawn }
 */
function microphoneState(deps = {}) {
  const prefs = deps.prefs === undefined ? systemPreferences : deps.prefs;
  const platform = deps.platform || process.platform;
  const spawnFn = deps.spawn || spawn;
  if (platform === 'darwin') {
    if (!prefs || typeof prefs.getMediaAccessStatus !== 'function') return 'unknown';
    const status = prefs.getMediaAccessStatus('microphone');
    return ['granted', 'denied', 'restricted', 'not-determined'].includes(status) ? status : 'unknown';
  }
  if (platform === 'win32') {
    return new Promise((resolve) => {
      const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
      try {
        const child = spawnFn('reg', ['query', key, '/v', 'Value'], { windowsHide: true });
        let out = '';
        child.stdout.on('data', (d) => (out += d.toString()));
        child.on('error', () => resolve('unknown'));
        child.on('exit', (code) => {
          if (code !== 0) return resolve('unknown');
          resolve(/Allow/i.test(out) ? 'granted' : 'denied');
        });
      } catch (e) {
        resolve('unknown');
      }
    });
  }
  return Promise.resolve('unknown');
}

/** True when dictation can run with this microphone state. 'unknown' is allowed: the bridge
 *  reports real errors when audio fails, so an unknown state must not block dictation. */
function canDictate(state) {
  return state === 'granted' || state === 'not-determined' || state === 'unknown';
}

/**
 * Runs `ask` while the given window can take keyboard focus, and restores the window afterwards.
 *
 * The keyboard window is not focusable (so clicks never steal focus from the app being typed
 * into), but macOS attaches its permission prompts to the app's active window: without one, a
 * microphone request is denied silently and the prompt never appears. Making the window briefly
 * focusable lets the system show the dialog; VoxKey then shows up in the Microphone list.
 *
 * @param getWindow returns the BrowserWindow to focus, or null
 * @param ask the permission request; its result is returned
 */
async function askWithFocusedWindow(getWindow, ask) {
  const win = typeof getWindow === 'function' ? getWindow() : null;
  const focusable = win && !win.isDestroyed() && typeof win.setFocusable === 'function';
  const wasFocusable = focusable && typeof win.isFocusable === 'function' ? win.isFocusable() : false;
  if (focusable) {
    win.setFocusable(true);
    win.show();
    win.focus();
  }
  try {
    return await ask();
  } finally {
    if (focusable && !win.isDestroyed()) {
      // The keyboard window is normally not focusable; keep it that way after the prompt.
      win.setFocusable(wasFocusable);
    }
  }
}

module.exports = { askWithFocusedWindow, canDictate, canType, microphoneState, openPermissionSettings };
