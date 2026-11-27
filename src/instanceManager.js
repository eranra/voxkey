const http = require('http');
const { PORT, APP_VERSION, isNewerVersion } = require('./config');

class InstanceManager {
  constructor(port = PORT, version = APP_VERSION) {
    this.port = port;
    this.version = version;
  }

  pingRunningInstance(timeoutMs = 1200) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${this.port}/api/status`, { timeout: timeoutMs }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
  }

  requestTakeover(timeoutMs = 1200) {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.port}/api/takeover?newVersion=${this.version}`, { timeout: timeoutMs }, () => {
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  requestShow(timeoutMs = 1200) {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.port}/api/show`, { timeout: timeoutMs }, () => {
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  async handleDuplicate(app, argv = process.argv) {
    try {
      const remote = await this.pingRunningInstance();

      // If we are newer or forced, ask old instance to yield
      if (isNewerVersion(this.version, remote.version) || argv.includes('--force') || argv.includes('--takeover')) {
        console.log(`[InstanceManager] Newer version detected (${this.version} > ${remote.version}). Taking over...`);
        await this.requestTakeover();
        // Give the old instance a moment to exit
        await new Promise(r => setTimeout(r, 600));
        return { shouldQuit: false, tookOver: true };
      } else {
        // Same or older version: tell existing instance to show its window and exit
        console.log(`[InstanceManager] Instance already running (v${remote.version}). Showing existing window...`);
        await this.requestShow();
        app.quit();
        return { shouldQuit: true, tookOver: false };
      }
    } catch (e) {
      // Running instance is unresponsive or not serving HTTP yet
      console.log(`[InstanceManager] Running instance not responding. Exiting duplicate.`);
      app.quit();
      return { shouldQuit: true, tookOver: false };
    }
  }
}

module.exports = {
  InstanceManager
};
