const { PATHS, APP_VERSION } = require('./config');

/**
 * Builds the tray menu as plain data, so it can be tested without Electron.
 * Each item is { label, command } | { label, enabled: false } | { label, checked, command } |
 * { label, type: 'radio'|'checkbox', checked, command } | { label, submenu } | { type: 'separator' }.
 */
function buildTrayMenuModel({
  version = APP_VERSION,
  updateLabel = null,
  checkForUpdates = true,
  voiceMode = 'toggle'
} = {}) {
  const separator = { type: 'separator' };
  const top = updateLabel ? [{ label: updateLabel, command: 'update' }, separator] : [];
  return [
    ...top,
    { label: `VoxKey v${version}`, enabled: false },
    separator,
    { label: 'Show / Hide Keyboard', command: 'toggleKeyboard' },
    { label: 'Toggle Voice Typing (F8)', command: 'toggleVoice' },
    {
      label: 'Voice Typing Mode',
      submenu: [
        {
          label: 'Toggle — stays on until pressed again',
          type: 'radio',
          checked: voiceMode !== 'until-silence',
          command: 'setVoiceModeToggle'
        },
        {
          label: 'Stops after silence',
          type: 'radio',
          checked: voiceMode === 'until-silence',
          command: 'setVoiceModeUntilSilence'
        }
      ]
    },
    separator,
    { label: 'About VoxKey', command: 'about' },
    { label: 'Check for Updates…', command: 'checkUpdates' },
    { label: 'Check for Updates Automatically', type: 'checkbox', checked: checkForUpdates, command: 'toggleAutoUpdate' },
    separator,
    { label: 'Quit VoxKey', command: 'quit' }
  ];
}

/** Turns the menu model into an Electron menu template. `run(command)` handles clicks. */
function toMenuTemplate(model, run) {
  return model.map((item) => {
    if (item.type === 'separator') return { type: 'separator' };
    const entry = { label: item.label };
    if (item.enabled === false) entry.enabled = false;
    if (item.type === 'checkbox' || item.type === 'radio') {
      entry.type = item.type;
      entry.checked = item.checked;
    }
    if (item.submenu) entry.submenu = toMenuTemplate(item.submenu, run);
    if (item.command) entry.click = () => run(item.command);
    return entry;
  });
}

/**
 * Tray icon file for each system (made by scripts/make-icons.js):
 * - macOS: a black "template" image; macOS colors it to match a light or dark menu bar.
 * - Windows: the colored waveform.
 */
function trayIconFile(platform) {
  return platform === 'darwin' ? PATHS.trayIconMac : PATHS.trayIconWin;
}

class TrayManager {
  constructor(electron = require('electron')) {
    this.electron = electron;
    this.tray = null;
    this.run = () => {};
  }

  /** `run(command)` is called with the menu command names from `buildTrayMenuModel`. */
  createTray(run, options = {}) {
    const { Tray, nativeImage } = this.electron;
    this.run = run;

    const icon = nativeImage.createFromPath(trayIconFile(process.platform));
    if (process.platform === 'darwin') icon.setTemplateImage(true);

    this.tray = new Tray(icon);
    this.tray.setToolTip(`VoxKey v${APP_VERSION}\nPress F8 to dictate\nClick to Show/Hide`);
    this.refresh(options);

    this.tray.on('click', () => run('toggleKeyboard'));
    return this.tray;
  }

  /** Rebuilds the menu, for example when an update is found or a setting changes. */
  refresh(options = {}) {
    if (!this.tray) return;
    const { Menu } = this.electron;
    const template = toMenuTemplate(buildTrayMenuModel(options), this.run);
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  destroy() {
    if (this.tray) {
      try {
        this.tray.destroy();
      } catch (e) {}
      this.tray = null;
    }
  }
}

module.exports = {
  buildTrayMenuModel,
  toMenuTemplate,
  trayIconFile,
  TrayManager
};
