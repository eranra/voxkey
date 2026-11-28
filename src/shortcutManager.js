const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { PATHS, unpackedPath } = require('./config');

/** The helper binary that reports key presses and releases (macOS only). It sits next to the
 *  Windows injector, outside the app.asar archive, so it can be spawned directly. */
const KEYSTATE_HELPER = unpackedPath(path.join(PATHS.root, 'bin', 'keystate-macos'));

/**
 * The shortcuts a user can pick, per platform.
 * - kind 'accelerator': registered with Electron's globalShortcut (fires on key down only).
 * - kind 'polled': watched by the key-state helper (fires on down and on up). Modifier keys
 *   such as the right Option key cannot be global shortcuts at all — registering a bare
 *   modifier would swallow it system-wide — so they are only available as polled shortcuts.
 */
const SHORTCUTS = {
  f8: { label: 'F8', kind: 'accelerator', accelerator: 'F8', keyCode: 'f8' },
  f6: { label: 'F6', kind: 'accelerator', accelerator: 'F6', keyCode: 'f6' },
  ctrlShiftSpace: { label: 'Ctrl+Shift+Space', kind: 'accelerator', accelerator: 'CommandOrControl+Shift+Space' },
  rightOption: { label: 'Right Option (hold)', kind: 'polled', keyCode: 'rightoption', platform: 'darwin' },
  rightCommand: { label: 'Right Command (hold)', kind: 'polled', keyCode: 'rightcommand', platform: 'darwin' }
};

/** The shortcuts offered in the menu, in order. */
function shortcutChoices(platform = process.platform) {
  return Object.entries(SHORTCUTS)
    .filter(([, def]) => !def.platform || def.platform === platform)
    .map(([key, def]) => ({ key, label: def.label }));
}

/**
 * Owns the voice activation shortcut.
 *
 * - 'toggle' and 'until-silence' modes with an accelerator shortcut keep using Electron's
 *   globalShortcut, exactly as before (F8 out of the box).
 * - 'hold' mode, and modifier shortcuts (right Option, right Command), run the key-state
 *   helper and activate on key down; in 'hold' mode they also stop on key up.
 *
 * @param deps injected for tests: { globalShortcut, spawn, platform, fileExists }
 */
class ShortcutManager {
  constructor(deps = {}) {
    this.globalShortcut = deps.globalShortcut || (require('electron') && require('electron').globalShortcut);
    this.spawn = deps.spawn || spawn;
    this.platform = deps.platform || process.platform;
    this.fileExists = deps.fileExists || ((p) => fs.existsSync(p));
    this.shortcut = 'f8';
    this.mode = 'toggle';
    this.onActivate = () => {};
    this.onRelease = () => {};
    this.helper = null;
    this.isStopping = false;
    this.pressed = {};
  }

  /** Applies a shortcut (a SHORTCUTS key) and a voice mode; re-registers everything. */
  configure(shortcut, mode) {
    this.shortcut = SHORTCUTS[shortcut] ? shortcut : 'f8';
    this.mode = mode;
    this.reapply();
  }

  /** True when the key-state helper must run for the current shortcut and mode. */
  needsHelper() {
    if (this.platform !== 'darwin') return false;
    const def = SHORTCUTS[this.shortcut];
    return def.kind === 'polled' || this.mode === 'hold';
  }

  reapply() {
    this.unregisterAccelerator();
    this.stopHelper();
    if (this.needsHelper()) {
      this.startHelper();
    } else {
      // The classic path: a plain global shortcut, unchanged from before this module existed.
      const def = SHORTCUTS[this.shortcut];
      const ok = this.globalShortcut.register(def.accelerator, () => this.activated());
      if (!ok) console.warn(`[ShortcutManager] Could not register ${def.accelerator}.`);
    }
  }

  unregisterAccelerator() {
    for (const def of Object.values(SHORTCUTS)) {
      if (def.accelerator && this.globalShortcut.isRegistered(def.accelerator)) {
        this.globalShortcut.unregister(def.accelerator);
      }
    }
  }

  /** The shortcut was pressed (key down). */
  activated() {
    if (this.mode === 'hold') {
      this.onActivate();
    } else if (!this.pressed[this.shortcut]) {
      // In toggle modes a press is one activation; the helper repeats while the key is held.
      this.pressed[this.shortcut] = true;
      this.onActivate();
    }
  }

  /** The shortcut was released (key up). */
  released() {
    this.pressed[this.shortcut] = false;
    if (this.mode === 'hold') this.onRelease();
  }

  startHelper() {
    if (this.helper || this.isStopping) return;
    if (!this.fileExists(KEYSTATE_HELPER)) {
      console.warn('[ShortcutManager] Key-state helper not found; the shortcut cannot detect holding.');
      // Fall back to a plain global shortcut, so activation still works (without hold).
      const def = SHORTCUTS[this.shortcut];
      if (def.accelerator) this.globalShortcut.register(def.accelerator, () => this.activated());
      return;
    }
    try {
      const child = this.spawn(KEYSTATE_HELPER, []);
      this.helper = child;
      let buffer = '';
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          this.handleHelperLine(line);
        }
      });
      child.on('exit', () => {
        this.helper = null;
        if (!this.isStopping) setTimeout(() => this.reapply(), 1000);
      });
      child.on('error', () => {
        this.helper = null;
      });
    } catch (err) {
      this.helper = null;
      console.warn('[ShortcutManager] Could not start the key-state helper:', err.message);
    }
  }

  handleHelperLine(line) {
    const def = SHORTCUTS[this.shortcut];
    if (!def) return;
    const match = /^(down|up) (.+)$/.exec(line);
    if (!match) return;
    const [, direction, key] = match;
    if (key !== def.keyCode) return;
    if (direction === 'down') this.activated();
    else this.released();
  }

  stopHelper() {
    if (this.helper) {
      try {
        this.helper.kill();
      } catch (e) {}
      this.helper = null;
    }
  }

  stop() {
    this.isStopping = true;
    this.unregisterAccelerator();
    this.stopHelper();
  }
}

module.exports = { KEYSTATE_HELPER, SHORTCUTS, ShortcutManager, shortcutChoices };
