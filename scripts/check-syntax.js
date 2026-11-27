#!/usr/bin/env node
// Checks that every JavaScript file in the project parses (`node --check`), without running it.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'out', 'build']);

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

let failed = 0;
const files = jsFiles(root);
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`Syntax error in ${path.relative(root, file)}:\n${err.stderr}`);
  }
}
console.log(`Checked ${files.length} files: ${failed === 0 ? 'all OK' : `${failed} failed`}.`);
process.exit(failed === 0 ? 0 : 1);
