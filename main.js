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
const { requestMicrophoneAccess } = require('./src/micPermission');
const { askWithFocusedWindow, canDictate, canType, microphoneState, openPermissionSettings } = require('./src/permissions');
const { ShortcutManager } = require('./src/shortcutManager');
const { applyAutoStart } = require('./src/autoStart');

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
  const injectorMgr = new InjectorManager(undefined, {
    clipboard,
    appName: app.name,
    // A failed typing command usually means the Accessibility permission is gone (a reinstall
    // gets a new signature). Tell the user instead of dropping the keystroke silently.
    onMacError: () => {
      pushPermissions({ typing: false });
      openPermissionPane('accessibility', 'a typing command failed');
      void refreshPermissions({ openPanes: false });
    }
  });
  const trayMgr = new TrayManager();
  const aboutWindow = new AboutWindow(BrowserWindow);
  const shortcutMgr = new ShortcutManager({ globalShortcut });

  /** Asks for microphone access while the keyboard window can take focus, so macOS can show
   *  the system prompt (the window is normally not focusable, and a prompt with no active
   *  window is denied silently — that is why VoxKey never appeared in the Microphone list). */
  const askMicrophone = () =>
    askWithFocusedWindow(() => windowMgr.getWindow(), requestMicrophoneAccess);

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
      voiceMode: store.get().voiceMode,
      voiceShortcut: store.get().voiceShortcut,
      startWithSystem: store.get().startWithSystem
    });
  }

  /** Sends a message to the keyboard window, if it exists. */
  function sendToKeyboard(channel, payload) {
    const win = windowMgr.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  // ---- Permissions: the app must tell the user when it cannot type or listen ----------------------
  //
  // On macOS every reinstall (ad-hoc signed, new signature) needs fresh Accessibility and
  // Microphone grants; without them typing and dictation fail silently. The keyboard window
  // shows a warning, and the matching system settings pane opens when the user tries anyway.

  let lastPaneOpenedAt = 0;
  /** Opens a settings pane at most once every few seconds, so it cannot spam over key presses. */
  function openPermissionPane(permission, reason) {
    console.warn(`[VoxKey] Missing permission: ${permission} (${reason}).`);
    const now = Date.now();
    if (now - lastPaneOpenedAt > 5000) {
      lastPaneOpenedAt = now;
      openPermissionSettings(permission);
    }
  }

  // The last known state; partial updates (from a failed typing command) must not clear the
  // microphone warning, so the two are merged before the keyboard window is told.
  let lastPermissions = { typing: true, microphone: 'unknown' };

  function pushPermissions(patch) {
    lastPermissions = Object.assign({}, lastPermissions, patch);
    sendToKeyboard('permissions', lastPermissions);
  }

  /** Checks both permissions, tells the keyboard window, and opens the pane of what is missing. */
  async function refreshPermissions({ openPanes = true } = {}) {
    const typing = canType();
    const microphone = await microphoneState();
    pushPermissions({ typing, microphone });
    if (!typing) {
      if (openPanes) openPermissionPane('accessibility', 'typing is blocked');
      return { typing, microphone };
    }
    if (!canDictate(microphone)) {
      if (openPanes) openPermissionPane('microphone', `state: ${microphone}`);
    }
    return { typing, microphone };
  }

  /** Runs the startup check once the keyboard window exists, so the warning is actually shown.
   *  The microphone is requested with the window focused, so the system prompt can appear.
   *  While something is missing, the permissions are re-checked every few seconds, so the
   *  warning bar clears by itself the moment the user flips the switch in System Settings. */
  function scheduleStartupPermissionCheck() {
    setTimeout(async () => {
      const state = await refreshPermissions();
      if (state && state.microphone === 'not-determined' && process.platform === 'darwin') {
        await askMicrophone();
      }
      if (state && (!state.typing || !canDictate(state.microphone))) {
        const timer = setInterval(async () => {
          const next = await refreshPermissions({ openPanes: false });
          if (next && next.typing && canDictate(next.microphone)) clearInterval(timer);
        }, 3000);
      }
    }, 1500);
  }

  /** Runs a typing command only when the Accessibility permission allows it. */
  function gateTyping(action) {
    if (canType()) {
      action();
      return;
    }
    // Without Accessibility the keystroke would fail silently; tell the user instead.
    pushPermissions({ typing: false });
    openPermissionPane('accessibility', 'a key was pressed');
    void refreshPermissions({ openPanes: false });
  }

  function handleToggleVoice(forceLang = null) {
    // If the keyboard is hidden, show it so the user sees the transcript.
    const win = windowMgr.getWindow();
    if (win && (!win.isVisible() || win.isMinimized())) {
      windowMgr.show();
    }
    // Dictation cannot work without the microphone; block the start with a clear message
    // instead of letting the bridge listen to silence.
    void (async () => {
      let microphone = await microphoneState();
      if (microphone === 'not-determined') {
        // Ask with the window focused, so macOS can show the prompt; a real prompt resolves
        // granted or denied after the user answers. A result that is neither means macOS
        // refused to show the prompt at all: the user must switch VoxKey on in the settings
        // pane instead.
        if (process.platform === 'darwin') {
          const askResult = await askMicrophone();
          if (askResult === 'granted' || askResult === 'denied') {
            microphone = askResult;
          }
        }
      }
      if (!canDictate(microphone)) {
        pushPermissions({ microphone });
        sendToKeyboard('voice-error', voiceErrorText('mic-permission'));
        openPermissionPane('microphone', `state: ${microphone}`);
        return;
      }
      speechServer.toggleVoice(forceLang);
    })();
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
      // A bridge that stopped answering, or whose microphone went silent, is replaced, so the
      // next press of the mic works. A silent microphone is often a missing permission, so the
      // keyboard warning is refreshed too.
      if (error === 'bridge-no-response' || error === 'mic-stuck') {
        speechServer.restartBridge();
        void refreshPermissions({ openPanes: false });
      }
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
      case 'toggleStartWithSystem': {
        const enabled = !store.get().startWithSystem;
        store.update({ startWithSystem: enabled });
        applyAutoStart(app, enabled);
        console.log(`[VoxKey Engine] Start with system: ${enabled ? 'on' : 'off'}`);
        refreshTray();
        break;
      }
      case 'setVoiceModeToggle':
      case 'setVoiceModeUntilSilence':
      case 'setVoiceModeHold': {
        const mode =
          command === 'setVoiceModeUntilSilence' ? 'until-silence' : command === 'setVoiceModeHold' ? 'hold' : 'toggle';
        store.update({ voiceMode: mode });
        speechServer.setVoiceMode(mode);
        shortcutMgr.configure(store.get().voiceShortcut, mode);
        sendToKeyboard('voice-mode', mode);
        refreshTray();
        break;
      }
      case 'setVoiceShortcut:f8':
      case 'setVoiceShortcut:f6':
      case 'setVoiceShortcut:ctrlShiftSpace':
      case 'setVoiceShortcut:rightOption':
      case 'setVoiceShortcut:rightCommand': {
        const shortcut = command.split(':')[1];
        store.update({ voiceShortcut: shortcut });
        shortcutMgr.configure(shortcut, store.get().voiceMode);
        console.log(`[VoxKey Engine] Voice shortcut changed to: ${shortcut}`);
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
    trayMgr.createTray(runCommand, { voiceShortcut: store.get().voiceShortcut });
    refreshTray();
    scheduleStartupPermissionCheck();

    // 4. The voice activation shortcut (configured in the tray; F8 by default) and the fixed
    //    Ctrl+Shift+Space combination. Modifier shortcuts and 'hold' mode run the key-state
    //    helper, so the release of the key can stop the dictation.
    shortcutMgr.onActivate = () => {
      if (shortcutMgr.mode === 'hold') {
        // Start listening when the key goes down (if it is not already running).
        if (!speechServer.isRecording && !speechServer.startTimer) handleToggleVoice();
      } else {
        handleToggleVoice();
      }
    };
    shortcutMgr.onRelease = () => {
      // 'hold' mode: the key was let go — stop listening; the recognized text is still typed.
      if (speechServer.isRecording || speechServer.startTimer) handleToggleVoice();
    };
    shortcutMgr.configure(store.get().voiceShortcut, store.get().voiceMode);
    const registeredCombo =
      store.get().voiceShortcut === 'ctrlShiftSpace' || globalShortcut.register('CommandOrControl+Shift+Space', () => handleToggleVoice());

    // 5. Follow the saved start-with-system setting (the app itself always starts idle:
    //    dictation never begins on its own, and every other setting is restored from disk).
    applyAutoStart(app, store.get().startWithSystem);

    // 6. Update checks (packaged builds only).
    updater.start();

    console.log(
      `[VoxKey v${APP_VERSION}] Ready. Shortcut: ${shortcutMgr.shortcut} (${shortcutMgr.mode}), Ctrl+Shift+Space (${registeredCombo})`
    );
  });

  // Messages from the pages (see renderer/preload.js).
  ipcMain.on('inject-text', (event, text) => gateTyping(() => injectorMgr.sendText(String(text))));
  ipcMain.on('inject-key', (event, keyName) => gateTyping(() => injectorMgr.sendKey(String(keyName))));
  ipcMain.on('toggle-voice', () => handleToggleVoice());
  ipcMain.on('open-permission-settings', (event, permission) => {
    if (['accessibility', 'microphone'].includes(permission)) openPermissionSettings(permission);
  });
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
    shortcutMgr.stop();
    globalShortcut.unregisterAll();
    updater.stop();
    trayMgr.destroy();
    injectorMgr.stop();
    speechServer.stop();
  });

  // Closing the About window must not quit the app; VoxKey keeps running in the tray.
  app.on('window-all-closed', () => {});
}
