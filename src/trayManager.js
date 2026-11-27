const { Tray, Menu, nativeImage } = require('electron');
const { PATHS, APP_VERSION } = require('./config');

class TrayManager {
  constructor() {
    this.tray = null;
  }

  createTray(callbacks = {}) {
    const onToggleKeyboard = callbacks.onToggleKeyboard || (() => {});
    const onToggleVoice = callbacks.onToggleVoice || (() => {});
    const onQuit = callbacks.onQuit || (() => {});

    let icon = nativeImage.createFromPath(PATHS.icon);

    this.tray = new Tray(icon);
    this.tray.setToolTip(`VoxKey v${APP_VERSION}\nPress F8 to dictate\nClick to Show/Hide`);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `VoxKey v${APP_VERSION}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Show / Hide Keyboard',
        click: () => onToggleKeyboard()
      },
      {
        label: 'Toggle Voice Typing (F8)',
        click: () => onToggleVoice()
      },
      { type: 'separator' },
      {
        label: 'Quit VoxKey',
        click: () => onQuit()
      }
    ]);

    this.tray.setContextMenu(contextMenu);

    this.tray.on('click', () => {
      onToggleKeyboard();
    });

    return this.tray;
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
  TrayManager
};
