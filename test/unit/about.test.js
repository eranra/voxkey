const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { aboutInfo } = require('../../src/aboutWindow');
const { secureWebPreferences } = require('../../src/windowManager');
const { PATHS } = require('../../src/config');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('About window', () => {
  it('shows version, system and update information', () => {
    const info = aboutInfo({
      version: '0.1.0',
      versions: { electron: '44.9.0', chrome: '140.0' },
      platform: 'darwin',
      arch: 'arm64',
      channel: 'notify-mac',
      state: { kind: 'available', version: '0.2.0' }
    });
    assert.strictEqual(info.version, '0.1.0');
    assert.strictEqual(info.platform, 'macOS');
    assert.strictEqual(info.electron, '44.9.0');
    assert.strictEqual(info.updateStatus, 'Version 0.2.0 is available.');
    assert.strictEqual(info.updateMode, 'You are told about new versions');
    assert.strictEqual(info.license, 'MIT');
    assert.strictEqual(info.author, 'Eran Raichstein');
    assert.strictEqual(info.repoUrl, 'https://github.com/eranra/voxkey');
    assert.strictEqual(info.releasesUrl, 'https://github.com/eranra/voxkey/releases');
    assert.strictEqual(info.issuesUrl, 'https://github.com/eranra/voxkey/issues');
  });

  it('names Windows correctly', () => {
    assert.strictEqual(aboutInfo({ version: '1.0.0', platform: 'win32' }).platform, 'Windows');
  });

  it('has a Check for Updates button and the three links', () => {
    const html = read('renderer/about.html');
    assert.match(html, /id="check"/);
    for (const link of ['repo', 'releases', 'issues']) assert.match(html, new RegExp(`data-link="${link}"`));
  });
});

describe('page security', () => {
  it('every window uses the preload API, without Node.js in the page', () => {
    const prefs = secureWebPreferences();
    assert.strictEqual(prefs.nodeIntegration, false);
    assert.strictEqual(prefs.contextIsolation, true);
    assert.strictEqual(prefs.sandbox, true);
    assert.ok(fs.existsSync(prefs.preload));
    assert.strictEqual(prefs.preload, PATHS.preload);
  });

  it('pages block network access and outside scripts', () => {
    for (const page of ['renderer/index.html', 'renderer/about.html']) {
      const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(read(page))?.[1] ?? '';
      assert.match(csp, /default-src 'self'/, page);
      assert.match(csp, /script-src 'self'/, page);
      assert.doesNotMatch(csp, /https?:|\*/, page);
    }
  });

  it('page scripts do not use require() (they run without Node.js)', () => {
    for (const script of ['renderer/app.js', 'renderer/about.js']) {
      assert.doesNotMatch(read(script), /\brequire\(/, script);
    }
  });

  it('every message the preload sends or asks for is handled in main.js', () => {
    const preload = read('renderer/preload.js');
    const main = read('main.js');
    const sent = [...preload.matchAll(/ipcRenderer\.send\('([^']+)'/g)].map((m) => m[1]);
    const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]);
    assert.ok(sent.length >= 10);
    for (const channel of sent) assert.match(main, new RegExp(`ipcMain\\.on\\('${channel}'`), channel);
    for (const channel of invoked) assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`), channel);
  });

  it('every preload function the pages call exists', () => {
    const preload = read('renderer/preload.js');
    const exposed = new Set([...preload.matchAll(/^\s+(\w+): \(/gm)].map((m) => m[1]));
    for (const page of ['renderer/app.js', 'renderer/about.js']) {
      const used = [...read(page).matchAll(/\b(?:voxkey|api)\.(\w+)\(/g)].map((m) => m[1]);
      for (const fn of used) assert.ok(exposed.has(fn), `${page} calls ${fn}, which preload.js does not expose`);
    }
  });
});
