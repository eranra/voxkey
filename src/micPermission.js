const { systemPreferences } = require('electron');

/**
 * Asks macOS for microphone access for this app, once.
 *
 * The speech bridge is a Chrome process that VoxKey starts, and macOS attributes the microphone
 * use of a started process to the app that started it — VoxKey itself. Without this request the
 * bridge gets silent audio instead of an error: the recognizer then listens forever and types
 * nothing (observed on macOS, 2026-11-28). Asking once at startup makes macOS show the usual
 * "VoxKey would like to access the microphone" prompt.
 *
/**
 * @param prefs injected for tests; defaults to Electron's systemPreferences
 * @param platform injected for tests; defaults to the process platform
 */
async function requestMicrophoneAccess(prefs = systemPreferences, platform = process.platform) {
  if (platform !== 'darwin' || !prefs || typeof prefs.getMediaAccessStatus !== 'function') {
    return 'unavailable';
  }
  const status = prefs.getMediaAccessStatus('microphone');
  if (status === 'granted') {
    console.log('[VoxKey] Microphone access: granted');
    return status;
  }
  if (status === 'denied' || status === 'restricted') {
    console.warn(
      `[VoxKey] Microphone access is ${status}. Voice typing needs it: allow VoxKey in System Settings > Privacy & Security > Microphone.`
    );
    return status;
  }
  try {
    const granted = await prefs.askForMediaAccess('microphone');
    console.log(`[VoxKey] Microphone access: ${granted ? 'granted' : 'not granted'}`);
    return granted ? 'granted' : 'denied';
  } catch (err) {
    console.warn('[VoxKey] Could not ask for microphone access:', err.message);
    return 'unavailable';
  }
}

module.exports = { requestMicrophoneAccess };
