const path = require('path');
const pkg = require('../package.json');

const APP_VERSION = pkg.version || '0.0.3';
const PORT = 19876;

const PATHS = {
  root: path.join(__dirname, '..'),
  bin: path.join(__dirname, '..', 'bin'),
  injector: path.join(__dirname, '..', 'bin', 'injector.exe'),
  assets: path.join(__dirname, '..', 'assets'),
  icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  sttHtml: path.join(__dirname, '..', 'stt.html'),
  rendererIndex: path.join(__dirname, '..', 'renderer', 'index.html')
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

/**
 * Compare two semver strings (v1 > v2).
 * Returns true if v1 is strictly greater than v2.
 */
function isNewerVersion(v1, v2) {
  if (!v1) return false;
  if (!v2) return true;
  const p1 = v1.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = v2.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const num1 = p1[i] !== undefined ? p1[i] : 0;
    const num2 = p2[i] !== undefined ? p2[i] : 0;
    if (num1 > num2) return true;
    if (num1 < num2) return false;
  }
  return false;
}

module.exports = {
  APP_VERSION,
  PORT,
  PATHS,
  SIZES,
  isNewerVersion
};
