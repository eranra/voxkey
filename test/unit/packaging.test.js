const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');
const { REPO_URL } = require('../../src/update');
const { unpackedPath } = require('../../src/config');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('packaging', () => {
  const builder = read('electron-builder.yml');

  it('publishes to the same GitHub repository the updater checks', () => {
    assert.match(builder, /provider: github\s+owner: eranra\s+repo: voxkey/);
    assert.strictEqual(REPO_URL, 'https://github.com/eranra/voxkey');
    assert.strictEqual(pkg.homepage, REPO_URL);
  });

  it('builds a macOS dmg and a Windows installer for both CPU types', () => {
    assert.match(builder, /mac:[\s\S]*target: dmg\s+arch: \[arm64, x64\]/);
    assert.match(builder, /win:[\s\S]*target: nsis\s+arch: \[x64, arm64\]/);
  });

  it('packs every file the app loads', () => {
    for (const entry of ['main.js', 'package.json', 'stt.html', 'src/**/*', 'renderer/**/*', 'assets/**/*', 'bin/**/*']) {
      assert.ok(builder.includes(`- ${entry}`), entry);
    }
    assert.ok(fs.existsSync(path.join(root, 'assets', 'entitlements.mac.plist')));
  });

  it('has one file list only, so platform settings cannot widen it', () => {
    assert.strictEqual((builder.match(/^\s*files:/gm) || []).length, 1);
  });

  it('electron-updater is a runtime dependency; Electron tools are dev dependencies', () => {
    assert.ok(pkg.dependencies['electron-updater']);
    assert.ok(pkg.devDependencies.electron);
    assert.ok(pkg.devDependencies['electron-builder']);
    assert.strictEqual(pkg.dependencies.electron, undefined);
  });

  it('finds the Windows helper outside app.asar in packaged builds', () => {
    assert.strictEqual(unpackedPath('C:\\VoxKey\\resources\\app.asar\\bin\\injector.exe'), 'C:\\VoxKey\\resources\\app.asar.unpacked\\bin\\injector.exe');
    assert.strictEqual(unpackedPath('/x/app.asar/bin/injector.exe'), '/x/app.asar.unpacked/bin/injector.exe');
    assert.strictEqual(unpackedPath('/dev/voxkey/bin/injector.exe'), '/dev/voxkey/bin/injector.exe');
  });

  it('CI and releases run on macOS and Windows', () => {
    for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      assert.match(read(workflow), /os: \[macos-latest, windows-latest\]/, workflow);
    }
    assert.match(read('.github/workflows/release.yml'), /tags: \['v\*'\]/);
  });

  it('the release workflow creates one draft before the build jobs upload to it', () => {
    const release = read('.github/workflows/release.yml');
    assert.match(release, /^  draft:/m);
    assert.match(release, /gh release create "\$GITHUB_REF_NAME"[^\n]*--draft/);
    assert.match(release, /^  package:\n    needs: draft/m);
  });

  it('the changelog has an entry for this version', () => {
    assert.match(read('CHANGELOG.md'), new RegExp(`## \\[${pkg.version.replace(/\./g, '\\.')}\\]`));
  });
});
