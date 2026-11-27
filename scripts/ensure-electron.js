#!/usr/bin/env node
// Makes sure the Electron binary is downloaded and unpacked.
//
// Electron's own postinstall script can fail in two ways:
// - Newer npm versions block install scripts that are not allow-listed.
// - On newer Node versions, its zip extraction can exit before it finishes,
//   so dist/ is incomplete and path.txt is never written.
// This script downloads the same artifact and unpacks it with system tools.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const electronDir = path.dirname(require.resolve('electron/package.json'));
const { version } = require(path.join(electronDir, 'package.json'));
const distDir = path.join(electronDir, 'dist');
const pathTxt = path.join(electronDir, 'path.txt');

const PLATFORM_PATHS = {
  darwin: 'Electron.app/Contents/MacOS/Electron',
  win32: 'electron.exe',
  linux: 'electron'
};

const platformPath = PLATFORM_PATHS[process.platform];
if (!platformPath) {
  console.error(`[ensure-electron] Unsupported platform: ${process.platform}`);
  process.exit(1);
}

function isInstalled() {
  try {
    const distVersion = fs.readFileSync(path.join(distDir, 'version'), 'utf-8').trim().replace(/^v/, '');
    const recordedPath = fs.readFileSync(pathTxt, 'utf-8');
    return distVersion === version && recordedPath === platformPath &&
      fs.existsSync(path.join(distDir, platformPath));
  } catch {
    return false;
  }
}

function unzip(zipPath, targetDir) {
  if (process.platform === 'darwin') {
    // ditto keeps the symlinks and permissions inside Electron.app.
    execFileSync('ditto', ['-x', '-k', zipPath, targetDir], { stdio: 'inherit' });
  } else if (process.platform === 'win32') {
    // tar.exe ships with Windows 10 and later and can read zip files.
    execFileSync('tar', ['-xf', zipPath, '-C', targetDir], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', targetDir], { stdio: 'inherit' });
  }
}

async function main() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD || isInstalled()) {
    return;
  }

  console.log(`[ensure-electron] Installing Electron v${version} binary...`);
  const { downloadArtifact } = require('@electron/get');
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    checksums: require(path.join(electronDir, 'checksums.json')),
    platform: process.platform,
    arch: process.arch
  });

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  unzip(zipPath, distDir);

  // Same layout as Electron's install.js: the type definitions live one level up.
  const typeDefs = path.join(distDir, 'electron.d.ts');
  if (fs.existsSync(typeDefs)) {
    fs.renameSync(typeDefs, path.join(electronDir, 'electron.d.ts'));
  }

  fs.writeFileSync(pathTxt, platformPath);

  if (!isInstalled()) {
    throw new Error('Electron binary is still missing after unpacking.');
  }
  console.log('[ensure-electron] Done.');
}

main().catch((err) => {
  console.error('[ensure-electron] Failed:', err.message);
  process.exit(1);
});
