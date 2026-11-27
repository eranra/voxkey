const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { PATHS } = require('../../src/config');
const { InjectorManager } = require('../../src/injectorManager');

describe('InjectorManager Integration Tests', () => {
  it('bin/injector.exe binary should exist and be executable', () => {
    assert.ok(fs.existsSync(PATHS.injector), `Binary not found at ${PATHS.injector}`);
  });

  it('should start persistent injector process and report alive', async () => {
    const mgr = new InjectorManager(PATHS.injector);
    const started = mgr.start();

    if (process.platform === 'win32') {
      assert.strictEqual(started, true);
      assert.strictEqual(mgr.isAlive(), true);

      // Test sending text through stdin stream
      mgr.sendText('test_unit');
      mgr.sendKey('SPACE');
      mgr.sendKey('BACKSPACE');

      // Test hide bridge command
      mgr.hideBridgeWindow();

      // Give it a moment to ensure no crash
      await new Promise(r => setTimeout(r, 200));
      assert.strictEqual(mgr.isAlive(), true);

      mgr.stop();
      await new Promise(r => setTimeout(r, 200));
      assert.strictEqual(mgr.isAlive(), false);
    }
  });
});
