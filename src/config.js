const path = require('path');
const pkg = require('../package.json');
const { isNewer } = require('./update');

const APP_VERSION = pkg.version;
const PORT = 19876;

const root = path.join(__dirname, '..');

/**
 * Files that other programs must open directly (not through Electron) cannot stay inside the
 * app.asar archive. electron-builder puts them in app.asar.unpacked (see `asarUnpack`).
 */
function unpackedPath(filePath) {
  return filePath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

const PATHS = {
  root,
  bin: path.join(root, 'bin'),
  injector: unpackedPath(path.join(root, 'bin', 'injector.exe')),
  assets: path.join(root, 'assets'),
  icon: path.join(root, 'assets', 'icon.png'),
  sttHtml: path.join(root, 'stt.html'),
  rendererIndex: path.join(root, 'renderer', 'index.html'),
  aboutHtml: path.join(root, 'renderer', 'about.html'),
  preload: path.join(root, 'renderer', 'preload.js')
};

const SIZES = {
  full: {
    width: 840,
    height: 310
  },
  compact: {
    width: 280,
    height: 56
  }
};

/** True if v1 is strictly newer than v2. Kept for older callers; same as `isNewer`. */
function isNewerVersion(v1, v2) {
  return isNewer(v1, v2);
}

module.exports = {
  APP_VERSION,
  PORT,
  PATHS,
  SIZES,
  isNewerVersion,
  unpackedPath
};
