const {
  FIRST_CHECK_DELAY_SECONDS,
  INSTALL_COMMAND,
  isNewer,
  latestMetadataUrl,
  releaseUrl,
  RELEASES_URL,
  shouldAnnounce,
  UPDATE_CHECK_HOURS,
  updateChannel,
  versionFromMetadata
} = require('./update');

/**
 * Checks GitHub Releases for new versions and installs them where the system allows.
 * See `src/update.js` for how each system is updated.
 *
 * State, shown in the tray menu and the About window, is one of:
 *   { kind: 'idle' } | { kind: 'checking' } | { kind: 'up-to-date', checkedAt }
 *   { kind: 'available', version } | { kind: 'downloading', version, percent }
 *   { kind: 'ready', version } | { kind: 'error', message }
 *
 * `deps` holds the Electron parts (so tests can pass fakes):
 *   app, autoUpdater, dialog, shell, clipboard, fetch, notify(title, body), platform
 * `hooks`:
 *   autoCheckEnabled(), lastAnnounced(), setLastAnnounced(version), onState(state), log(...items)
 */
class Updater {
  constructor(deps, hooks) {
    this.deps = deps;
    this.hooks = hooks;
    this.platform = deps.platform || process.platform;
    this.channel = updateChannel({ platform: this.platform, packaged: deps.app.isPackaged });
    this.state = { kind: 'idle' };
    this.busy = false;
    this.firstTimer = null;
    this.timer = null;

    const { autoUpdater } = deps;
    if (autoUpdater && this.channel === 'auto') {
      autoUpdater.logger = {
        info: (m) => hooks.log('updater:', m),
        warn: (m) => hooks.log('updater:', m),
        error: (m) => hooks.log('updater error:', m),
        debug: () => {}
      };
      // Download only on systems that can install; install on quit if the user chose "Later".
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowPrerelease = false;
      autoUpdater.on('download-progress', (p) => {
        if (this.state.kind === 'downloading' || this.state.kind === 'available') {
          this.set({ kind: 'downloading', version: this.state.version, percent: Math.round(p.percent) });
        }
      });
      // Without an 'error' listener, Node.js throws on a failed download and the app would crash.
      autoUpdater.on('error', (err) => {
        const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
        hooks.log('updater error:', message);
        if (this.state.kind === 'downloading') this.set({ kind: 'error', message });
      });
      autoUpdater.on('update-downloaded', (info) => {
        this.set({ kind: 'ready', version: info.version });
        void this.offerRestart(info.version);
      });
    }
  }

  get currentVersion() {
    return this.deps.app.getVersion();
  }

  /** Starts automatic checks: shortly after start, then every few hours. */
  start() {
    if (this.channel === 'none') return;
    const tick = () => {
      if (this.hooks.autoCheckEnabled()) void this.check(false);
    };
    this.firstTimer = setTimeout(tick, FIRST_CHECK_DELAY_SECONDS * 1000);
    this.timer = setInterval(tick, UPDATE_CHECK_HOURS * 3600 * 1000);
  }

  stop() {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
    this.firstTimer = null;
    this.timer = null;
  }

  /** Checks now. `manual` = the user asked ("Check for Updates…"): always show the result. */
  async check(manual) {
    const { dialog, shell } = this.deps;
    this.hooks.log(`checking for updates (${manual ? 'manual' : 'automatic'}, channel ${this.channel})`);
    if (this.channel === 'none') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          message: 'Updates are off when running from source',
          detail: `This copy runs from source (version ${this.currentVersion}). Use git pull to update.`
        });
      }
      return;
    }
    if (this.busy) return;
    if (this.state.kind === 'ready') {
      if (manual) void this.offerRestart(this.state.version);
      return;
    }
    this.busy = true;
    this.set({ kind: 'checking' });
    try {
      // Windows uses electron-updater (it downloads and installs). macOS only needs the newest
      // version number, so read the release metadata directly; nothing is downloaded.
      const latest = this.channel === 'auto'
        ? (await this.deps.autoUpdater.checkForUpdates())?.updateInfo?.version
        : await this.fetchLatestVersion();

      if (!latest || !isNewer(latest, this.currentVersion)) {
        this.set({ kind: 'up-to-date', checkedAt: Date.now() });
        if (manual) {
          await dialog.showMessageBox({
            type: 'info',
            message: "You're up to date",
            detail: `VoxKey ${this.currentVersion} is the newest version.`
          });
        }
        return;
      }

      const announce = shouldAnnounce(latest, this.currentVersion, this.hooks.lastAnnounced(), manual);
      if (announce) this.hooks.setLastAnnounced(latest);

      if (this.channel === 'auto') {
        // The download already started (autoDownload). "Restart Now" is offered when it is ready.
        this.set({ kind: 'downloading', version: latest, percent: 0 });
        if (announce) {
          this.deps.notify(`VoxKey ${latest} is available`, 'Downloading in the background. You can restart when it is ready.');
        }
        return;
      }

      this.set({ kind: 'available', version: latest });
      if (announce) await this.offerManualUpdate(latest);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      this.hooks.log('update check failed:', message);
      this.set({ kind: 'error', message });
      if (manual) {
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          message: 'Could not check for updates',
          detail: `${message}\n\nYou can check the releases page yourself.`,
          buttons: ['Open Releases Page', 'OK'],
          defaultId: 1,
          cancelId: 1
        });
        if (response === 0) void shell.openExternal(RELEASES_URL);
      }
    } finally {
      this.busy = false;
    }
  }

  /** Reads the newest published version from GitHub. Only github.com and its download host are contacted. */
  async fetchLatestVersion() {
    const response = await this.deps.fetch(latestMetadataUrl(this.platform), {
      headers: { 'User-Agent': `VoxKey/${this.currentVersion}`, 'Cache-Control': 'no-cache' }
    });
    if (response.status === 404) return undefined; // no release yet
    if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`);
    const version = versionFromMetadata(await response.text());
    if (!version) throw new Error('The release information could not be read');
    this.hooks.log('updater: newest release is', version);
    return version;
  }

  /** macOS: show what is new and how to update. */
  async offerManualUpdate(version) {
    const { dialog, shell, clipboard } = this.deps;
    const mac = this.channel === 'notify-mac';
    const buttons = mac ? ['Open Release Page', 'Copy Update Command', 'Later'] : ['Open Release Page', 'Later'];
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `VoxKey ${version} is available`,
      detail: mac
        ? `You have version ${this.currentVersion}.\n\nTo update, download the new version from the release page, ` +
          `or paste the update command in Terminal:\n\n${INSTALL_COMMAND}`
        : `You have version ${this.currentVersion}. Download the new version from the release page.`,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1
    });
    if (response === 0) void shell.openExternal(releaseUrl(version));
    if (mac && response === 1) {
      clipboard.writeText(INSTALL_COMMAND);
      this.deps.notify('Update command copied', 'Paste it in Terminal and press Return.');
    }
  }

  /** Windows: the new version is downloaded. */
  async offerRestart(version) {
    const { response } = await this.deps.dialog.showMessageBox({
      type: 'info',
      message: `VoxKey ${version} is ready to install`,
      detail: 'Restart VoxKey now to finish the update, or it will be installed the next time VoxKey quits.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (response === 0) setImmediate(() => this.deps.autoUpdater.quitAndInstall(true, true));
  }

  /** Runs the right action for the tray menu item "Update Available…". */
  act() {
    const s = this.state;
    if (s.kind === 'ready') void this.offerRestart(s.version);
    else if (s.kind === 'available') void this.offerManualUpdate(s.version);
    else if (s.kind === 'downloading') this.deps.notify(`Downloading VoxKey ${s.version}`, `${s.percent}% done.`);
    else void this.check(true);
  }

  set(state) {
    this.state = state;
    this.hooks.onState(state);
  }
}

module.exports = {
  Updater
};
