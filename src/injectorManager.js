const childProcess = require('child_process');
const fs = require('fs');
const { PATHS } = require('./config');

/** macOS virtual key codes for the special keys VoxKey sends. */
const MAC_KEY_SCRIPTS = Object.freeze({
  BACKSPACE: 'key code 51',
  ENTER: 'key code 36',
  SPACE: 'keystroke " "',
  TAB: 'key code 48',
  ESCAPE: 'key code 53'
});

/** AppleScript to press one special key, or null for an unknown key. */
function macKeyScript(keyName) {
  const action = MAC_KEY_SCRIPTS[String(keyName).toUpperCase()];
  return action ? `tell application "System Events" to ${action}` : null;
}

/** Escapes text for an AppleScript string literal. */
function appleScriptString(text) {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * How to type `text` on macOS.
 * System Events `keystroke` only types characters that exist on the current keyboard layout,
 * so printable ASCII is typed directly and everything else (Hebrew, Arabic, Chinese, emoji,
 * new lines) is pasted through the clipboard.
 */
function macTextPlan(text) {
  if (/^[\x20-\x7E]*$/.test(text)) {
    return { method: 'keystroke', script: `tell application "System Events" to keystroke ${appleScriptString(text)}` };
  }
  return { method: 'paste', script: 'tell application "System Events" to keystroke "v" using command down' };
}

/** Milliseconds to wait after a paste before the old clipboard text is put back. */
const CLIPBOARD_RESTORE_MS = 300;

/**
 * AppleScript that reports every change of the frontmost application on stderr, forever.
 * The keyboard window steals the focus on click on newer macOS versions, so typing must
 * re-activate the app the user was in first (see withTargetApp).
 */
const FRONTMOST_TRACKER_SCRIPT = `
set lastApp to ""
repeat
  tell application "System Events" to set f to (name of first application process whose frontmost is true)
  if f is not lastApp then
    set lastApp to f
    log f
  end if
  delay 0.25
end repeat`;

/** Milliseconds between activating the target app and typing into it. */
const ACTIVATE_SETTLE_MS = 150;

/**
 * Types text and keys into the app that has keyboard focus.
 * - Windows: a long-running helper (bin/injector.exe, built from native/injector.cs) reads commands on stdin.
 * - macOS: AppleScript through `osascript`. Needs Accessibility permission.
 */
class InjectorManager {
  constructor(injectorPath = PATHS.injector, deps = {}) {
    this.injectorPath = injectorPath;
    this.platform = deps.platform || process.platform;
    this.spawn = deps.spawn || childProcess.spawn;
    this.clipboard = deps.clipboard || null;
    // Called when a macOS typing command fails (missing Accessibility permission, ...).
    this.onMacError = deps.onMacError || null;
    // The name of our own process; the frontmost tracker ignores it.
    this.appName = deps.appName || 'VoxKey';
    // The app the user was in before the keyboard window took the focus; typing goes there.
    this.targetApp = null;
    this.trackerProcess = null;
    this.isStopping = false;
    this.process = null;
    // macOS commands run one after another, so fast key presses arrive in order.
    this.macQueue = Promise.resolve();
  }

  /**
   * Follows the frontmost application (macOS). Clicking the keyboard window activates VoxKey on
   * newer macOS versions even though the window is not focusable, which would otherwise send the
   * typed keys into the keyboard itself; remembering the user's app lets typing go back to it.
   */
  startFrontmostTracker() {
    if (this.trackerProcess || this.isStopping) return;
    try {
      const child = this.spawn('osascript', ['-e', FRONTMOST_TRACKER_SCRIPT]);
      this.trackerProcess = child;
      let buffer = '';
      child.stderr.on('data', (chunk) => {
        buffer += chunk.toString();
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const name = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (name && name !== this.appName) this.targetApp = name;
        }
      });
      child.on('exit', () => {
        this.trackerProcess = null;
        if (!this.isStopping) setTimeout(() => this.startFrontmostTracker(), 1000);
      });
      child.on('error', () => {
        this.trackerProcess = null;
      });
    } catch (err) {
      this.trackerProcess = null;
    }
  }

  /** A script that first re-activates the app the user is typing into, then runs `script`. */
  withTargetApp(script) {
    if (this.platform !== 'darwin' || !this.targetApp) return script;
    const name = appleScriptString(this.targetApp);
    return (
      `tell application "System Events" to set frontmost of process ${name} to true\n` +
      `delay ${(ACTIVATE_SETTLE_MS / 1000).toFixed(3)}\n` +
      script
    );
  }

  start() {
    this.isStopping = false;
    if (this.platform === 'darwin') this.startFrontmostTracker();
    if (this.platform !== 'win32' || !fs.existsSync(this.injectorPath)) {
      return false;
    }

    try {
      this.process = this.spawn(this.injectorPath, [], {
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true
      });

      this.process.on('exit', (code) => {
        this.process = null;
        if (!this.isStopping) {
          console.warn(`[InjectorManager] Process exited (${code}). Auto-restarting in 1s...`);
          setTimeout(() => this.start(), 1000);
        }
      });

      return true;
    } catch (err) {
      console.error('[InjectorManager] Failed to spawn injector:', err);
      return false;
    }
  }

  /** Sends one command line to the Windows helper, or runs it once with `fallbackArgs`. */
  sendWindows(line, fallbackArgs) {
    if (this.process && this.process.stdin && this.process.stdin.writable) {
      this.process.stdin.write(`${line}\n`);
    } else {
      this.spawn(this.injectorPath, fallbackArgs, { windowsHide: true });
    }
  }

  /** Types text. On macOS, returns a promise that resolves when it has been typed. */
  sendText(text) {
    if (!text) return Promise.resolve();

    if (this.platform === 'win32') {
      // One command per line: a line break inside the text would end the command early.
      const line = text.replace(/[\r\n]+/g, ' ');
      this.sendWindows(`TEXT:${line}`, ['--text', line]);
    } else if (this.platform === 'darwin') {
      const plan = macTextPlan(text);
      return plan.method === 'keystroke' ? this.runMac(plan.script) : this.pasteMac(text, plan.script);
    }
    return Promise.resolve();
  }

  /** Presses one special key (BACKSPACE, ENTER, SPACE, TAB, ESCAPE). */
  sendKey(keyName) {
    if (!keyName) return Promise.resolve();

    if (this.platform === 'win32') {
      this.sendWindows(`KEY:${keyName}`, ['--key', keyName]);
    } else if (this.platform === 'darwin') {
      const script = macKeyScript(keyName);
      if (script) return this.runMac(script);
    }
    return Promise.resolve();
  }

  hideBridgeWindow() {
    if (this.platform === 'win32') {
      this.sendWindows('HIDE_BRIDGE', ['--hide-bridge']);
    }
  }

  /** Queues one AppleScript. Returns a promise that resolves when it has finished. */
  runMac(script) {
    this.macQueue = this.macQueue.then(() => this.osascript(this.withTargetApp(script)));
    return this.macQueue;
  }

  /** Puts `text` on the clipboard, presses Cmd+V, then puts the old clipboard text back. */
  pasteMac(text, pasteScript) {
    const clipboard = this.clipboard;
    if (!clipboard) {
      console.warn('[InjectorManager] Clipboard not available; cannot type non-ASCII text.');
      return this.macQueue;
    }
    this.macQueue = this.macQueue.then(async () => {
      const previous = clipboard.readText();
      clipboard.writeText(text);
      await this.osascript(this.withTargetApp(pasteScript));
      await new Promise((r) => setTimeout(r, CLIPBOARD_RESTORE_MS));
      // Only restore if nothing else changed the clipboard in the meantime.
      if (clipboard.readText() === text) clipboard.writeText(previous);
    });
    return this.macQueue;
  }

  osascript(script) {
    return new Promise((resolve) => {
      let child;
      let stderr = '';
      try {
        child = this.spawn('osascript', ['-e', script]);
      } catch (err) {
        this.reportMacError(`spawn failed: ${err.message}`);
        resolve();
        return;
      }
      if (child.stderr) {
        child.stderr.on('data', (d) => {
          stderr += d.toString();
        });
      }
      child.on('error', (err) => {
        this.reportMacError(err.message);
        resolve();
      });
      child.on('exit', (code) => {
        // A missing Accessibility permission makes osascript exit non-zero ("osascript is not
        // allowed to send keystrokes"); without this check the typing fails silently.
        // A signal kill arrives as code null and is not an osascript failure.
        if (typeof code === 'number' && code !== 0) {
          this.reportMacError(`exit ${code}: ${stderr.trim().split('\n')[0] || 'no output'}`);
        }
        resolve();
      });
    });
  }

  /** Reports a failed typing command (missing permission, and the like) to the app. */
  reportMacError(detail) {
    console.warn('[InjectorManager] osascript failed:', detail);
    if (this.onMacError) this.onMacError(detail);
  }

  stop() {
    this.isStopping = true;
    if (this.trackerProcess) {
      try {
        this.trackerProcess.kill();
      } catch (e) {}
      this.trackerProcess = null;
    }
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {}
      this.process = null;
    }
  }

  isAlive() {
    return this.process !== null && !this.process.killed;
  }
}

module.exports = {
  CLIPBOARD_RESTORE_MS,
  ACTIVATE_SETTLE_MS,
  InjectorManager,
  MAC_KEY_SCRIPTS,
  appleScriptString,
  macKeyScript,
  macTextPlan
};
