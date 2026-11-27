const { spawn } = require('child_process');
const fs = require('fs');
const { PATHS } = require('./config');

class InjectorManager {
  constructor(injectorPath = PATHS.injector) {
    this.injectorPath = injectorPath;
    this.process = null;
    this.isStopping = false;
  }

  start() {
    if (process.platform !== 'win32' || !fs.existsSync(this.injectorPath)) {
      return false;
    }

    try {
      this.isStopping = false;
      this.process = spawn(this.injectorPath, [], {
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

  sendText(text) {
    if (!text) return;

    if (process.platform === 'win32') {
      if (this.process && this.process.stdin && this.process.stdin.writable) {
        this.process.stdin.write(`TEXT:${text}\n`);
      } else {
        // Fallback: one-off execution
        spawn(this.injectorPath, ['--text', text], { windowsHide: true });
      }
    } else if (process.platform === 'darwin') {
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      spawn('osascript', ['-e', `tell application "System Events" to keystroke "${escaped}"`]);
    }
  }

  sendKey(keyName) {
    if (!keyName) return;

    if (process.platform === 'win32') {
      if (this.process && this.process.stdin && this.process.stdin.writable) {
        this.process.stdin.write(`KEY:${keyName}\n`);
      } else {
        spawn(this.injectorPath, ['--key', keyName], { windowsHide: true });
      }
    } else if (process.platform === 'darwin') {
      const scriptMap = {
        'BACKSPACE': 'key code 51',
        'ENTER': 'key code 36',
        'SPACE': 'keystroke " "',
        'TAB': 'key code 48'
      };
      if (scriptMap[keyName]) {
        spawn('osascript', ['-e', `tell application "System Events" to ${scriptMap[keyName]}`]);
      }
    }
  }

  hideBridgeWindow() {
    if (process.platform === 'win32') {
      if (this.process && this.process.stdin && this.process.stdin.writable) {
        this.process.stdin.write('HIDE_BRIDGE\n');
      } else {
        spawn(this.injectorPath, ['--hide-bridge'], { windowsHide: true });
      }
    }
  }

  stop() {
    this.isStopping = true;
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
  InjectorManager
};
