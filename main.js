const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { APP_VERSION } = require('./src/config');
const { WindowManager } = require('./src/windowManager');
const { InjectorManager } = require('./src/injectorManager');
const { SpeechServer } = require('./src/speechServer');
const { TrayManager } = require('./src/trayManager');
const { InstanceManager } = require('./src/instanceManager');

// Top-level Single Instance Lock
const gotLock = app.requestSingleInstanceLock();
const instanceMgr = new InstanceManager();

if (!gotLock) {
  // Another instance is already running; handle version comparison or show existing
  instanceMgr.handleDuplicate(app);
} else {
  // Primary instance
  runPrimaryApp();
}

function runPrimaryApp() {
  const windowMgr = new WindowManager();
  const injectorMgr = new InjectorManager();
  const trayMgr = new TrayManager();

  let speechServer = null;

  // Toggle voice typing wrapper
  function handleToggleVoice(forceLang = null) {
    if (!speechServer) return;

    // If window is hidden, reveal it on top
    const win = windowMgr.getWindow();
    if (win && (!win.isVisible() || win.isMinimized())) {
      windowMgr.show();
    }

    speechServer.toggleVoice(forceLang);
  }

  // Handle incoming speech from backend
  speechServer = new SpeechServer({
    onSpeechResult: (data) => {
      const win = windowMgr.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('speech-update', {
          interim: data.interim,
          final: data.final
        });
      }

      if (data.final && data.final.trim().length > 0) {
        console.log(`[VoxKey Voice] Recognized: "${data.final}"`);
        injectorMgr.sendText(data.final + ' ');
      }
    },

    onSpeechStatus: (status) => {
      const win = windowMgr.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('voice-state', status);
      }
    },

    onSpeechError: (error) => {
      console.warn('[VoxKey Voice] Speech error:', error);
      const win = windowMgr.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('voice-state', 'idle');
      }
    },

    onBridgeConnect: () => {
      // Hide the background Chrome window as soon as it connects
      injectorMgr.hideBridgeWindow();
      setTimeout(() => injectorMgr.hideBridgeWindow(), 600);
      setTimeout(() => injectorMgr.hideBridgeWindow(), 1500);
    },

    onTakeoverRequest: () => {
      console.log('[VoxKey Engine] Received takeover request from newer version. Quitting cleanly...');
      app.quit();
    },

    onShowRequest: () => {
      windowMgr.toggle(screen, true);
    }
  });

  // Second instance attempted while primary is running
  app.on('second-instance', (event, commandLine) => {
    console.log('[VoxKey Engine] Second instance detected. Showing keyboard...');
    if (!commandLine.includes('--minimized')) {
      windowMgr.toggle(screen, true);
    }
  });

  // App Lifecycle
  app.whenReady().then(async () => {
    const startMinimized = process.argv.includes('--minimized') || process.argv.includes('--tray');

    // 1. Start Win32 keystroke injector
    injectorMgr.start();

    // 2. Start local speech server and launch background speech bridge
    await speechServer.start();
    speechServer.launchChromeBridge(() => injectorMgr.hideBridgeWindow());

    // 3. Create VoxKey Window
    windowMgr.createWindow(BrowserWindow, screen, startMinimized);

    // 4. Create System Tray
    trayMgr.createTray({
      onToggleKeyboard: () => windowMgr.toggle(screen),
      onToggleVoice: () => handleToggleVoice(),
      onQuit: () => app.quit()
    });

    // 5. Register Global Shortcuts: F8 and Ctrl+Shift+Space
    const registeredF8 = globalShortcut.register('F8', () => {
      console.log('[Shortcut] F8 pressed: toggling voice typing');
      handleToggleVoice();
    });

    const registeredCombo = globalShortcut.register('CommandOrControl+Shift+Space', () => {
      console.log('[Shortcut] Ctrl+Shift+Space pressed: toggling voice typing');
      handleToggleVoice();
    });

    console.log(`[VoxKey v${APP_VERSION}] Ready. Shortcuts: F8 (${registeredF8}), Ctrl+Shift+Space (${registeredCombo})`);
  });

  // IPC Handlers from Renderer
  ipcMain.on('inject-text', (event, text) => {
    injectorMgr.sendText(text);
  });

  ipcMain.on('inject-key', (event, keyName) => {
    injectorMgr.sendKey(keyName);
  });

  ipcMain.on('toggle-voice', () => {
    handleToggleVoice();
  });

  ipcMain.on('set-lang', (event, lang) => {
    if (speechServer) speechServer.setLanguage(lang);
    console.log(`[VoxKey Engine] Language changed to: ${lang}`);
  });

  ipcMain.on('resize-window', (event, { collapsed }) => {
    windowMgr.resize(screen, collapsed);
  });

  ipcMain.on('hide-to-tray', () => {
    windowMgr.hide();
  });

  ipcMain.on('close-app', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    trayMgr.destroy();
    injectorMgr.stop();
    if (speechServer) speechServer.stop();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
