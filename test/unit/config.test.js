const { describe, it } = require('node:test');
const assert = require('node:assert');
const { APP_VERSION, PORT, SIZES, PATHS, isNewerVersion } = require('../../src/config');
const fs = require('fs');

describe('Config & Version Helper Unit Tests', () => {
  it('should have valid version string', () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it('should have valid port number', () => {
    assert.strictEqual(PORT, 19876);
  });

  it('should have correct window size definitions', () => {
    assert.strictEqual(SIZES.full.width, 840);
    assert.strictEqual(SIZES.full.height, 310);
    assert.strictEqual(SIZES.compact.width, 280);
    assert.strictEqual(SIZES.compact.height, 56);
  });

  it('should point to valid required files', () => {
    assert.ok(fs.existsSync(PATHS.injector), 'bin/injector.exe must exist');
    assert.ok(fs.existsSync(PATHS.sttHtml), 'stt.html must exist');
    assert.ok(fs.existsSync(PATHS.icon), 'assets/icon.png must exist');
    assert.ok(fs.existsSync(PATHS.rendererIndex), 'renderer/index.html must exist');
  });

  describe('isNewerVersion() Semver Comparison', () => {
    it('should detect newer patch versions', () => {
      assert.strictEqual(isNewerVersion('0.0.4', '0.0.3'), true);
      assert.strictEqual(isNewerVersion('0.0.3', '0.0.4'), false);
    });

    it('should detect newer minor versions', () => {
      assert.strictEqual(isNewerVersion('0.1.0', '0.0.9'), true);
      assert.strictEqual(isNewerVersion('0.0.9', '0.1.0'), false);
    });

    it('should detect newer major versions', () => {
      assert.strictEqual(isNewerVersion('1.0.0', '0.9.9'), true);
      assert.strictEqual(isNewerVersion('0.9.9', '1.0.0'), false);
    });

    it('should return false for equal versions', () => {
      assert.strictEqual(isNewerVersion('0.0.3', '0.0.3'), false);
    });

    it('should handle optional "v" prefix', () => {
      assert.strictEqual(isNewerVersion('v0.0.4', 'v0.0.3'), true);
      assert.strictEqual(isNewerVersion('v1.2.0', '1.1.9'), true);
    });

    it('should handle missing or malformed versions safely', () => {
      assert.strictEqual(isNewerVersion('0.0.1', null), true);
      assert.strictEqual(isNewerVersion(null, '0.0.1'), false);
      assert.strictEqual(isNewerVersion('', '0.0.1'), false);
    });
  });
});
