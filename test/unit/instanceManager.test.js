const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { InstanceManager } = require('../../src/instanceManager');

describe('InstanceManager Unit Tests', () => {
  const TEST_PORT = 19992;
  let server;
  let lastRequest = null;

  before(async () => {
    server = http.createServer((req, res) => {
      lastRequest = req.url;
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.0.1', pid: 1234 }));
      } else if (req.url.startsWith('/api/takeover')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, quitting: true }));
      } else if (req.url === '/api/show') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(r => server.listen(TEST_PORT, '127.0.0.1', r));
  });

  after(() => {
    if (server) server.close();
  });

  it('pingRunningInstance should fetch remote version and pid', async () => {
    const mgr = new InstanceManager(TEST_PORT, '0.0.3');
    const status = await mgr.pingRunningInstance();
    assert.strictEqual(status.version, '0.0.1');
    assert.strictEqual(status.pid, 1234);
  });

  it('requestTakeover should contact takeover endpoint', async () => {
    const mgr = new InstanceManager(TEST_PORT, '0.0.3');
    const success = await mgr.requestTakeover();
    assert.strictEqual(success, true);
    assert.ok(lastRequest.includes('/api/takeover'));
  });

  it('requestShow should contact show endpoint', async () => {
    const mgr = new InstanceManager(TEST_PORT, '0.0.3');
    const success = await mgr.requestShow();
    assert.strictEqual(success, true);
    assert.strictEqual(lastRequest, '/api/show');
  });

  it('handleDuplicate should signal takeover if running instance is older', async () => {
    const mgr = new InstanceManager(TEST_PORT, '0.0.3'); // Newer than remote 0.0.1
    let quitCalled = false;
    const mockApp = { quit: () => { quitCalled = true; } };

    const result = await mgr.handleDuplicate(mockApp, []);
    assert.strictEqual(result.tookOver, true);
    assert.strictEqual(result.shouldQuit, false);
    assert.strictEqual(quitCalled, false);
  });

  it('handleDuplicate should call app.quit if running instance is same version', async () => {
    const mgr = new InstanceManager(TEST_PORT, '0.0.1'); // Same as remote 0.0.1
    let quitCalled = false;
    const mockApp = { quit: () => { quitCalled = true; } };

    const result = await mgr.handleDuplicate(mockApp, []);
    assert.strictEqual(result.tookOver, false);
    assert.strictEqual(result.shouldQuit, true);
    assert.strictEqual(quitCalled, true);
  });
});

describe('InstanceManager takeover', () => {
  it('waits until the old copy releases the lock', async () => {
    let tries = 0;
    const app = { requestSingleInstanceLock: () => ++tries >= 3 };
    const mgr = new InstanceManager(1, '0.0.3');
    assert.strictEqual(await mgr.acquireLockAfterTakeover(app, { attempts: 5, delayMs: 1 }), true);
    assert.strictEqual(tries, 3);
  });

  it('gives up when the old copy never exits', async () => {
    const app = { requestSingleInstanceLock: () => false };
    const mgr = new InstanceManager(1, '0.0.3');
    assert.strictEqual(await mgr.acquireLockAfterTakeover(app, { attempts: 3, delayMs: 1 }), false);
  });

  it('quits when nothing answers on the port', async () => {
    let quit = false;
    const mgr = new InstanceManager(1, '0.0.3'); // port 1: nothing listens there
    const result = await mgr.handleDuplicate({ quit: () => (quit = true) }, []);
    assert.deepStrictEqual(result, { shouldQuit: true, tookOver: false });
    assert.strictEqual(quit, true);
  });
});
