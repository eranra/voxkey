const path = require('path');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  Notification,
  screen,
  shell
} = require('electron');
const { APP_VERSION } = require('./src/config');
const { WindowManager } = require('./src/windowManager');
const { InjectorManager } = require('./src/injectorManager');
const { SpeechServer, voiceErrorText } = require('./src/speechServer');
const { TrayManager } = require('./src/trayManager');
const { InstanceManager } = require('./src/instanceManager');
const { SettingsStore } = require('./src/store');
const { Updater } = require('./src/updater');
const { AboutWindow, aboutInfo } = require('./src/aboutWindow');
const { createDialogs } = require('./src/dialogs');
const { isAllowedLink, updateMenuLabel } = require('./src/update');

const instanceMgr = new InstanceManager();

if (app.requestSingleInstanceLock()) {
  runPrimaryApp();
} else {
  // Another copy is running. Either it shows its window and we quit, or (we are newer) it quits and we take over.
  instanceMgr.handleDuplicate(app).then(async ({ tookOver }) => {
    if (!tookOver) return;
    if (await instanceMgr.acquireLockAfterTakeover(app)) {
      console.log('[VoxKey Engine] Took over from the older version.');
      runPrimaryApp();
    } else {
      console.warn('[VoxKey Engine] The older version did not exit. Quitting.');
      app.quit();
    }
  });
}

function runPrimaryApp() {
  const store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  const windowMgr = new WindowManager();
  const injectorMgr = new InjectorManager(undefined, { clipboard });
  const trayMgr = new TrayManager();
  const aboutWindow = new AboutWindow(BrowserWindow);

  const notify = (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  };

  // Message boxes that never hide behind the always-on-top keyboard (see src/dialogs.js).
  const dialogs = createDialogs({
    dialog,
    app,
    // Update messages appear as a sheet on the About window, which also shows the update status.
    getParent: () => aboutWindow.openAndWait(),
    getKeyboard: () => windowMgr.getWindow()
  });

  const updater = new Updater(
    {
      app,
      autoUpdater: require('electron-updater').autoUpdater,
      dialog: dialogs,
      shell,
      clipboard,
      fetch: (url, init) => net.fetch(url, init),
      notify
    },
    {
      autoCheckEnabled: () => store.get().checkForUpdates,
      lastAnnounced: () => store.get().lastAnnouncedVersion,
      setLastAnnounced: (version) => store.update({ lastAnnouncedVersion: version }),
      onState: () => {
        refreshTray();
        aboutWindow.send(currentAboutInfo());
      },
      log: (...items) => console.log('[Updater]', ...items)
    }
  );

  function currentAboutInfo() {
    return aboutInfo({ version: APP_VERSION, channel: updater.channel, state: updater.state });
  }

  function refreshTray() {
    trayMgr.refresh({
      updateLabel: updateMenuLabel(updater.state),
      checkForUpdates: store.get().checkForUpdates,
      voiceMode: store.get().voiceMode
    });
  }

  /** Sends a message to the keyboard window, if it exists. */
  function sendToKeyboard(channel, payload) {
    const win = windowMgr.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  function handleToggleVoice(forceLang = null) {
    // If the keyboard is hidden, show it so the user sees the transcript.
    const win = windowMgr.getWindow();
    if (win && (!win.isVisible() || win.isMinimized())) {
      windowMgr.show();
    }
    speechServer.toggleVoice(forceLang);
  }

  const speechServer = new SpeechServer({
    onSpeechResult: (data) => {
      sendToKeyboard('speech-update', { interim: data.interim, final: data.final });
      if (data.final && data.final.trim().length > 0) {
        console.log(`[VoxKey Voice] Recognized: "${data.final}"`);
        injectorMgr.sendText(data.final + ' ');
      }
    },
    onSpeechStatus: (status) => sendToKeyboard('voice-state', status),
    onSpeechError: (error) => {
      console.warn('[VoxKey Voice] Speech error:', error);
      sendToKeyboard('voice-state', 'idle');
      sendToKeyboard('voice-error', voiceErrorText(error));
      // A bridge that stopped answering is replaced, so the next press of the mic works.
      if (error === 'bridge-no-response') speechServer.restartBridge();
    },
    onAudioLevel: (level) => sendToKeyboard('audio-level', level),
    onBridgeConnect: () => {
      // Hide the background Chrome window as soon as it connects (Windows only; a no-op elsewhere).
      injectorMgr.hideBridgeWindow();
      setTimeout(() => injectorMgr.hideBridgeWindow(), 600);
      setTimeout(() => injectorMgr.hideBridgeWindow(), 1500);
    },
    onTakeoverRequest: () => {
      console.log('[VoxKey Engine] A newer version asked to take over. Quitting...');
      app.quit();
    },
    onShowRequest: () => windowMgr.toggle(screen, true),
    onBridgeReady: () => injectorMgr.hideBridgeWindow()
  });
  speechServer.setLanguage(store.get().language);
  speechServer.setVoiceMode(store.get().voiceMode);

  /** Tray menu commands (see buildTrayMenuModel in src/trayManager.js). */
  function runCommand(command) {
    switch (command) {
      case 'toggleKeyboard':
        windowMgr.toggle(screen);
        break;
      case 'toggleVoice':
        handleToggleVoice();
        break;
      case 'about':
        aboutWindow.open();
        break;
      case 'checkUpdates':
        void updater.check(true);
        break;
      case 'update':
        updater.act();
        break;
      case 'toggleAutoUpdate':
        store.update({ checkForUpdates: !store.get().checkForUpdates });
        refreshTray();
        break;
      case 'setVoiceModeToggle':
      case 'setVoiceModeUntilSilence': {
        const mode = command === 'setVoiceModeUntilSilence' ? 'until-silence' : 'toggle';
        store.update({ voiceMode: mode });
        speechServer.setVoiceMode(mode);
        sendToKeyboard('voice-mode', mode);
        refreshTray();
        break;
      }
      case 'quit':
        app.quit();
        break;
      default:
        console.warn('[VoxKey Engine] Unknown command:', command);
    }
  }

  app.on('second-instance', (event, commandLine) => {
    console.log('[VoxKey Engine] Second instance detected. Showing keyboard...');
    if (!commandLine.includes('--minimized')) {
      windowMgr.toggle(screen, true);
    }
  });

  app.whenReady().then(async () => {
    const startMinimized = process.argv.includes('--minimized') || process.argv.includes('--tray');

    // 1. Start the Windows keystroke helper (does nothing on macOS).
    injectorMgr.start();

    // 2. Start the local speech server and the background speech bridge.
    try {
      await speechServer.start();
      speechServer.launchChromeBridge(() => injectorMgr.hideBridgeWindow());
    } catch (err) {
      console.error(`[SpeechServer] Could not start on port ${speechServer.port}:`, err.message);
    }

    // 3. Keyboard window and tray icon.
    windowMgr.createWindow(BrowserWindow, screen, startMinimized);
    trayMgr.createTray(runCommand);
    refreshTray();

    // 4. Global shortcuts: F8 and Ctrl+Shift+Space (Cmd+Shift+Space on macOS).
    const registeredF8 = globalShortcut.register('F8', () => handleToggleVoice());
    const registeredCombo = globalShortcut.register('CommandOrControl+Shift+Space', () => handleToggleVoice());

    // 5. Update checks (packaged builds only).
    updater.start();

    console.log(`[VoxKey v${APP_VERSION}] Ready. Shortcuts: F8 (${registeredF8}), Ctrl+Shift+Space (${registeredCombo})`);
  });

  // Messages from the pages (see renderer/preload.js).
  ipcMain.on('inject-text', (event, text) => injectorMgr.sendText(String(text)));
  ipcMain.on('inject-key', (event, keyName) => injectorMgr.sendKey(String(keyName)));
  ipcMain.on('toggle-voice', () => handleToggleVoice());
  ipcMain.on('set-lang', (event, lang) => {
    const saved = store.update({ language: lang }).language;
    speechServer.setLanguage(saved);
    console.log(`[VoxKey Engine] Language changed to: ${saved}`);
  });
  ipcMain.on('resize-window', (event, { collapsed } = {}) => windowMgr.resize(screen, Boolean(collapsed)));
  ipcMain.on('hide-to-tray', () => windowMgr.hide());
  ipcMain.on('close-app', () => app.quit());
  ipcMain.on('open-about', () => aboutWindow.open());
  ipcMain.on('check-updates', () => void updater.check(true));
  ipcMain.on('open-link', (event, url) => {
    if (isAllowedLink(url)) void shell.openExternal(url);
  });
  ipcMain.handle('get-info', () => ({ version: APP_VERSION, language: store.get().language, voiceMode: store.get().voiceMode }));
  ipcMain.handle('get-about', () => currentAboutInfo());

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    updater.stop();
    trayMgr.destroy();
    injectorMgr.stop();
    speechServer.stop();
  });

  // Closing the About window must not quit the app; VoxKey keeps running in the tray.
  app.on('window-all-closed', () => {});
}
