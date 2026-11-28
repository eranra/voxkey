// Compiles the macOS key-state helper (scripts/keystate.swift) into bin/keystate-macos.
// Needed for modifier shortcuts and hold-to-talk. A no-op on other platforms and when the
// Swift compiler is missing (the app then falls back to plain global shortcuts).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'scripts', 'keystate.swift');
const output = path.join(root, 'bin', 'keystate-macos');

if (process.platform !== 'darwin') {
  console.log('[keyhelper] Not macOS; nothing to build.');
  process.exit(0);
}

try {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  execFileSync('swiftc', ['-O', source, '-o', output], { stdio: 'inherit' });
  console.log(`[keyhelper] Built ${output}`);
} catch (err) {
  console.warn('[keyhelper] Could not build the key-state helper:', err.message);
  console.warn('[keyhelper] Hold-to-talk and modifier shortcuts will not be available.');
  process.exit(0);
}
