const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Updater } = require('../../src/updater');
const { INSTALL_COMMAND } = require('../../src/update');

/** Fake Electron parts. `responses` are the button indexes the fake dialog "clicks", in order. */
function setup({ platform = 'darwin', packaged = true, version = '0.1.0', latest = '0.2.0', fetchStatus = 200, responses = [] } = {}) {
  const calls = { dialogs: [], opened: [], copied: [], notified: [], states: [], fetched: [], installs: 0 };
  let announced = null;
  const autoUpdater = Object.assign(new EventEmitter(), {
    checkForUpdates: async () => ({ updateInfo: { version: latest } }),
    quitAndInstall: () => calls.installs++
  });
  const deps = {
    platform,
    app: { isPackaged: packaged, getVersion: () => version },
    autoUpdater,
    dialog: {
      showMessageBox: async (opts) => {
        calls.dialogs.push(opts);
        return { response: responses.length ? responses.shift() : opts.cancelId ?? 0 };
      }
    },
    shell: { openExternal: async (url) => calls.opened.push(url) },
    clipboard: { writeText: (t) => calls.copied.push(t) },
    fetch: async (url) => {
      calls.fetched.push(url);
      return { status: fetchStatus, ok: fetchStatus === 200, text: async () => `version: ${latest}\n` };
    },
    notify: (title) => calls.notified.push(title)
  };
  const hooks = {
    autoCheckEnabled: () => true,
    lastAnnounced: () => announced,
    setLastAnnounced: (v) => (announced = v),
    onState: (s) => calls.states.push(s.kind),
    log: () => {}
  };
  return { updater: new Updater(deps, hooks), calls, autoUpdater, getAnnounced: () => announced };
}

describe('Updater on macOS', () => {
  it('finds a new version, tells once, and offers the release page and install command', async () => {
    const { updater, calls, getAnnounced } = setup({ responses: [1] });
    await updater.check(false);
    assert.deepStrictEqual(updater.state, { kind: 'available', version: '0.2.0' });
    assert.strictEqual(calls.fetched[0], 'https://github.com/eranra/voxkey/releases/latest/download/latest-mac.yml');
    assert.strictEqual(calls.dialogs.length, 1);
    assert.deepStrictEqual(calls.dialogs[0].buttons, ['Open Release Page', 'Copy Update Command', 'Later']);
    assert.deepStrictEqual(calls.copied, [INSTALL_COMMAND]);
    assert.strictEqual(getAnnounced(), '0.2.0');

    // A second automatic check does not ask again.
    await updater.check(false);
    assert.strictEqual(calls.dialogs.length, 1);
  });

  it('"Open Release Page" opens the release of that version', async () => {
    const { updater, calls } = setup({ responses: [0] });
    await updater.check(true);
    assert.deepStrictEqual(calls.opened, ['https://github.com/eranra/voxkey/releases/tag/v0.2.0']);
  });

  it('says "up to date" only on a manual check', async () => {
    const quiet = setup({ latest: '0.1.0' });
    await quiet.updater.check(false);
    assert.strictEqual(quiet.updater.state.kind, 'up-to-date');
    assert.strictEqual(quiet.calls.dialogs.length, 0);

    const loud = setup({ latest: '0.1.0' });
    await loud.updater.check(true);
    assert.strictEqual(loud.calls.dialogs[0].message, "You're up to date");
  });

  it('no release yet (HTTP 404) counts as up to date', async () => {
    const { updater } = setup({ fetchStatus: 404 });
    await updater.check(false);
    assert.strictEqual(updater.state.kind, 'up-to-date');
  });

  it('a network error becomes an error state; a manual check offers the releases page', async () => {
    const { updater, calls } = setup({ fetchStatus: 500, responses: [0] });
    await updater.check(true);
    assert.strictEqual(updater.state.kind, 'error');
    assert.match(updater.state.message, /HTTP 500/);
    assert.deepStrictEqual(calls.opened, ['https://github.com/eranra/voxkey/releases']);
  });
});

describe('Updater on Windows', () => {
  it('downloads in the background, then offers "Restart Now"', async () => {
    const { updater, calls, autoUpdater } = setup({ platform: 'win32', responses: [0] });
    assert.strictEqual(updater.channel, 'auto');
    await updater.check(false);
    assert.strictEqual(updater.state.kind, 'downloading');
    assert.strictEqual(calls.fetched.length, 0, 'Windows uses electron-updater, not the metadata fetch');
    assert.deepStrictEqual(calls.notified, ['VoxKey 0.2.0 is available']);

    autoUpdater.emit('download-progress', { percent: 42.4 });
    assert.deepStrictEqual(updater.state, { kind: 'downloading', version: '0.2.0', percent: 42 });

    autoUpdater.emit('update-downloaded', { version: '0.2.0' });
    assert.deepStrictEqual(updater.state, { kind: 'ready', version: '0.2.0' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(calls.dialogs.at(-1).message, 'VoxKey 0.2.0 is ready to install');
    assert.strictEqual(calls.installs, 1);
  });
});

describe('Updater download errors', () => {
  it('a failed Windows download becomes an error state, without crashing', async () => {
    const { updater, autoUpdater } = setup({ platform: 'win32' });
    await updater.check(false);
    assert.strictEqual(updater.state.kind, 'downloading');
    autoUpdater.emit('error', new Error('net::ERR_CONNECTION_RESET\nstack'));
    assert.deepStrictEqual(updater.state, { kind: 'error', message: 'net::ERR_CONNECTION_RESET' });
  });
});

describe('Updater when running from source', () => {
  it('never checks, and explains why on a manual check', async () => {
    const { updater, calls } = setup({ packaged: false });
    assert.strictEqual(updater.channel, 'none');
    updater.start();
    await updater.check(true);
    updater.stop();
    assert.strictEqual(calls.fetched.length, 0);
    assert.match(calls.dialogs[0].message, /running from source/);
  });
});
