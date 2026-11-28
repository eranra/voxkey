// The only bridge between VoxKey's pages and the main process.
// Pages run without Node.js; they can call exactly these functions.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voxkey', {
  // Keyboard window
  injectText: (text) => ipcRenderer.send('inject-text', String(text)),
  injectKey: (keyName) => ipcRenderer.send('inject-key', String(keyName)),
  toggleVoice: () => ipcRenderer.send('toggle-voice'),
  setLanguage: (lang) => ipcRenderer.send('set-lang', String(lang)),
  resizeWindow: (collapsed) => ipcRenderer.send('resize-window', { collapsed: Boolean(collapsed) }),
  hideToTray: () => ipcRenderer.send('hide-to-tray'),
  closeApp: () => ipcRenderer.send('close-app'),
  getInfo: () => ipcRenderer.invoke('get-info'),
  onVoiceState: (listener) => ipcRenderer.on('voice-state', (_event, state) => listener(state)),
  onSpeechUpdate: (listener) => ipcRenderer.on('speech-update', (_event, data) => listener(data)),
  onVoiceError: (listener) => ipcRenderer.on('voice-error', (_event, message) => listener(message)),
  onAudioLevel: (listener) => ipcRenderer.on('audio-level', (_event, level) => listener(level)),
  onVoiceMode: (listener) => ipcRenderer.on('voice-mode', (_event, mode) => listener(mode)),
  onPermissions: (listener) => ipcRenderer.on('permissions', (_event, state) => listener(state)),
  openPermissionSettings: (permission) => ipcRenderer.send('open-permission-settings', String(permission)),

  // About window
  openAbout: () => ipcRenderer.send('open-about'),
  getAbout: () => ipcRenderer.invoke('get-about'),
  onAboutUpdate: (listener) => ipcRenderer.on('about-update', (_event, info) => listener(info)),
  checkUpdates: () => ipcRenderer.send('check-updates'),
  openLink: (url) => ipcRenderer.send('open-link', String(url))
});
