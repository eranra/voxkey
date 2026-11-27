const pkg = require('../package.json');
const { PATHS } = require('./config');
const { ISSUES_URL, RELEASES_URL, REPO_URL, updateModeText, updateStatusText } = require('./update');
const { secureWebPreferences } = require('./windowManager');

const PLATFORM_NAMES = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** Everything the About window shows. Pure, so it can be tested. */
function aboutInfo({ version, versions = process.versions, platform = process.platform, arch = process.arch, channel = 'none', state = { kind: 'idle' } }) {
  return {
    version,
    electron: versions.electron || '',
    chrome: versions.chrome || '',
    platform: PLATFORM_NAMES[platform] || platform,
    arch,
    updateMode: updateModeText(channel),
    updateStatus: updateStatusText(state),
    repoUrl: REPO_URL,
    releasesUrl: RELEASES_URL,
    issuesUrl: ISSUES_URL,
    license: pkg.license,
    author: pkg.author.name || pkg.author
  };
}

/** One About window at a time. Opening it again brings the existing one to the front. */
class AboutWindow {
  constructor(BrowserWindow) {
    this.BrowserWindow = BrowserWindow;
    this.window = null;
  }

  open() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }
    this.window = new this.BrowserWindow({
      width: 380,
      height: 420,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      title: 'About VoxKey',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#1e1f24',
      webPreferences: secureWebPreferences()
    });
    this.window.loadFile(PATHS.aboutHtml);
    this.window.once('ready-to-show', () => this.window && this.window.show());
    this.window.on('closed', () => {
      this.window = null;
    });
    return this.window;
  }

  /** Sends fresh information to the window, if it is open. */
  send(info) {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('about-update', info);
  }

  isOpen() {
    return Boolean(this.window && !this.window.isDestroyed());
  }
}

module.exports = {
  AboutWindow,
  PLATFORM_NAMES,
  aboutInfo
};
