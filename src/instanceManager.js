const http = require('http');
const { PORT, APP_VERSION, isNewerVersion } = require('./config');
const { CLIENT_HEADER } = require('./speechServer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Makes sure only one VoxKey runs. When a second copy starts:
 * - same or older version: the running copy shows its window, and the second copy quits;
 * - newer version (or --takeover / --force): the running copy quits, and the new copy takes its place.
 */
class InstanceManager {
  constructor(port = PORT, version = APP_VERSION) {
    this.port = port;
    this.version = version;
  }

  /** GET on the running instance's local API. Resolves with the parsed JSON body. */
  request(pathname, timeoutMs = 1200) {
    return new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${this.port}${pathname}`,
        { timeout: timeoutMs, headers: { [CLIENT_HEADER]: '1' } },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
  }

  pingRunningInstance(timeoutMs = 1200) {
    return this.request('/api/status', timeoutMs);
  }

  requestTakeover(timeoutMs = 1200) {
    return this.request(`/api/takeover?newVersion=${encodeURIComponent(this.version)}`, timeoutMs).then(
      () => true,
      () => false
    );
  }

  requestShow(timeoutMs = 1200) {
    return this.request('/api/show', timeoutMs).then(
      () => true,
      () => false
    );
  }

  /**
   * Called when `app.requestSingleInstanceLock()` failed.
   * Returns { tookOver, shouldQuit }. When `tookOver` is true the old copy was asked to quit,
   * and the caller should get the lock with `acquireLockAfterTakeover`.
   */
  async handleDuplicate(app, argv = process.argv) {
    try {
      const remote = await this.pingRunningInstance();
      const forced = argv.includes('--force') || argv.includes('--takeover');

      if (isNewerVersion(this.version, remote.version) || forced) {
        console.log(`[InstanceManager] Taking over from v${remote.version} (this is v${this.version})...`);
        await this.requestTakeover();
        return { shouldQuit: false, tookOver: true };
      }

      // Same or older version: tell the running copy to show its window, and exit.
      console.log(`[InstanceManager] Instance already running (v${remote.version}). Showing existing window...`);
      await this.requestShow();
      app.quit();
      return { shouldQuit: true, tookOver: false };
    } catch (e) {
      console.log('[InstanceManager] Running instance not responding. Exiting duplicate.');
      app.quit();
      return { shouldQuit: true, tookOver: false };
    }
  }

  /**
   * After a takeover, waits for the old copy to exit and release the single-instance lock.
   * Resolves true when this copy holds the lock.
   */
  async acquireLockAfterTakeover(app, { attempts = 20, delayMs = 250 } = {}) {
    for (let i = 0; i < attempts; i++) {
      await sleep(delayMs);
      if (app.requestSingleInstanceLock()) return true;
    }
    return false;
  }
}

module.exports = {
  InstanceManager
};
