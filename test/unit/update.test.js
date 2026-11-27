const { describe, it } = require('node:test');
const assert = require('node:assert');
const u = require('../../src/update');

describe('versions', () => {
  it('parses common forms', () => {
    assert.deepStrictEqual(u.parseVersion('1.2.3').parts, [1, 2, 3]);
    assert.deepStrictEqual(u.parseVersion('v0.10.0').parts, [0, 10, 0]);
    assert.strictEqual(u.parseVersion('1.2.3-beta.1').pre, 'beta.1');
    assert.strictEqual(u.parseVersion('1.2'), null);
    assert.strictEqual(u.parseVersion('latest'), null);
    assert.strictEqual(u.parseVersion(null), null);
  });

  it('compares numerically, not as text', () => {
    assert.strictEqual(u.isNewer('0.10.0', '0.9.0'), true);
    assert.strictEqual(u.isNewer('0.2.0', '0.2.0'), false);
    assert.strictEqual(u.isNewer('0.1.9', '0.2.0'), false);
    assert.strictEqual(u.isNewer('1.0.0', '1.0.0-beta.2'), true);
    assert.strictEqual(u.isNewer('1.0.0-beta.2', '1.0.0'), false);
    assert.ok(u.compareVersions('1.0.0-beta.1', '1.0.0-beta.2') < 0);
    assert.strictEqual(u.isNewer('garbage', '0.1.0'), false);
  });

  it('builds the release link', () => {
    assert.strictEqual(u.releaseUrl('0.3.0'), 'https://github.com/eranra/voxkey/releases/tag/v0.3.0');
    assert.strictEqual(u.releaseUrl('v0.3.0'), 'https://github.com/eranra/voxkey/releases/tag/v0.3.0');
  });
});

describe('update channel', () => {
  it('installs automatically on Windows, tells the user on macOS', () => {
    assert.strictEqual(u.updateChannel({ platform: 'win32', packaged: true }), 'auto');
    assert.strictEqual(u.updateChannel({ platform: 'darwin', packaged: true }), 'notify-mac');
    assert.strictEqual(u.updateChannel({ platform: 'linux', packaged: true }), 'notify');
  });

  it('running from source never updates', () => {
    assert.strictEqual(u.updateChannel({ platform: 'darwin', packaged: false }), 'none');
    assert.strictEqual(u.updateChannel({ platform: 'win32', packaged: false }), 'none');
  });
});

describe('announcing', () => {
  it('automatic checks tell about each new version once', () => {
    assert.strictEqual(u.shouldAnnounce('0.3.0', '0.2.0', null, false), true);
    assert.strictEqual(u.shouldAnnounce('0.3.0', '0.2.0', '0.3.0', false), false);
    assert.strictEqual(u.shouldAnnounce('0.4.0', '0.2.0', '0.3.0', false), true);
  });

  it('a manual check always tells; nothing to tell when up to date', () => {
    assert.strictEqual(u.shouldAnnounce('0.3.0', '0.2.0', '0.3.0', true), true);
    assert.strictEqual(u.shouldAnnounce('0.2.0', '0.2.0', null, true), false);
  });
});

describe('release metadata', () => {
  it('reads the version from latest-mac.yml and latest.yml', () => {
    assert.strictEqual(u.versionFromMetadata("version: 0.2.0\nfiles:\n  - url: VoxKey-0.2.0-x64.dmg\nreleaseDate: '2026-11-04'"), '0.2.0');
    assert.strictEqual(u.versionFromMetadata("version: '1.4.0'\n"), '1.4.0');
    assert.strictEqual(u.versionFromMetadata('files: []\n'), null);
    assert.strictEqual(u.versionFromMetadata('version: <html>\n'), null);
  });

  it('points at the newest release of this repository', () => {
    assert.strictEqual(u.latestMetadataUrl('darwin'), 'https://github.com/eranra/voxkey/releases/latest/download/latest-mac.yml');
    assert.match(u.latestMetadataUrl('win32'), /\/latest\.yml$/);
  });
});

describe('status texts', () => {
  it('tray label only when there is something to act on', () => {
    assert.strictEqual(u.updateMenuLabel({ kind: 'idle' }), null);
    assert.strictEqual(u.updateMenuLabel({ kind: 'up-to-date' }), null);
    assert.strictEqual(u.updateMenuLabel({ kind: 'available', version: '0.3.0' }), 'Update Available: 0.3.0…');
    assert.strictEqual(u.updateMenuLabel({ kind: 'downloading', version: '0.3.0', percent: 40 }), 'Downloading Update 0.3.0 (40%)');
    assert.strictEqual(u.updateMenuLabel({ kind: 'ready', version: '0.3.0' }), 'Restart to Update to 0.3.0');
  });

  it('About window status and mode', () => {
    assert.strictEqual(u.updateStatusText({ kind: 'up-to-date' }), "You're up to date.");
    assert.strictEqual(u.updateStatusText({ kind: 'error', message: 'x' }), 'Could not check for updates.');
    assert.strictEqual(u.updateStatusText(undefined), '');
    assert.strictEqual(u.updateModeText('auto'), 'Updates install automatically');
    assert.strictEqual(u.updateModeText('none'), 'Development build');
    assert.strictEqual(u.updateModeText('notify-mac'), 'You are told about new versions');
  });
});

describe('links', () => {
  it('only our own GitHub pages can be opened', () => {
    assert.strictEqual(u.isAllowedLink(u.REPO_URL), true);
    assert.strictEqual(u.isAllowedLink(u.RELEASES_URL), true);
    assert.strictEqual(u.isAllowedLink(u.ISSUES_URL), true);
    assert.strictEqual(u.isAllowedLink('https://github.com/eranra/voxkey-fake'), false);
    assert.strictEqual(u.isAllowedLink('file:///etc/passwd'), false);
    assert.strictEqual(u.isAllowedLink(42), false);
  });

  it('the update command downloads install.sh from this repository', () => {
    assert.strictEqual(u.INSTALL_COMMAND, 'curl -fsSL https://raw.githubusercontent.com/eranra/voxkey/main/install.sh | bash');
  });
});
