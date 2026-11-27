const { describe, it } = require('node:test');
const assert = require('node:assert');
const { calculateBounds } = require('../../src/windowManager');
const { SIZES } = require('../../src/config');

describe('WindowManager calculateBounds() Unit Tests', () => {
  const display1080p = { width: 1920, height: 1040 }; // 1080p with taskbar

  it('should center full keyboard at bottom on standard 1080p screen', () => {
    const bounds = calculateBounds(display1080p.width, display1080p.height, false);

    assert.strictEqual(bounds.width, SIZES.full.width);
    assert.strictEqual(bounds.height, SIZES.full.height);
    // (1920 - 840) / 2 = 540
    assert.strictEqual(bounds.x, 540);
    // 1040 - 310 - 16 = 714
    assert.strictEqual(bounds.y, 714);
  });

  it('should place compact pill at bottom-right by default', () => {
    const bounds = calculateBounds(display1080p.width, display1080p.height, true);

    assert.strictEqual(bounds.width, SIZES.compact.width);
    assert.strictEqual(bounds.height, SIZES.compact.height);
    // 1920 - 280 - 30 = 1610
    assert.strictEqual(bounds.x, 1610);
    // 1040 - 56 - 20 = 964
    assert.strictEqual(bounds.y, 964);
  });

  it('should respect user dragged position in compact mode if inside bounds', () => {
    const userPos = { x: 300, y: 400 };
    const bounds = calculateBounds(display1080p.width, display1080p.height, true, userPos);

    assert.strictEqual(bounds.x, 300);
    assert.strictEqual(bounds.y, 400);
    assert.strictEqual(bounds.width, SIZES.compact.width);
    assert.strictEqual(bounds.height, SIZES.compact.height);
  });

  it('should strictly clamp coordinates inside viewport if user drags off-screen', () => {
    // Drags way past right edge and bottom edge
    const userPos = { x: 2500, y: 1500 };
    const bounds = calculateBounds(display1080p.width, display1080p.height, true, userPos);

    // Max X: 1920 - 280 - 10 = 1630
    assert.strictEqual(bounds.x, 1630);
    // Max Y: 1040 - 56 - 10 = 974
    assert.strictEqual(bounds.y, 974);
  });

  it('should strictly clamp negative coordinates (off top/left edge)', () => {
    const userPos = { x: -500, y: -200 };
    const bounds = calculateBounds(display1080p.width, display1080p.height, false, null, userPos);

    assert.strictEqual(bounds.x, 10);
    assert.strictEqual(bounds.y, 10);
  });

  it('should handle small screens safely without negative dimensions or crashing', () => {
    const smallScreen = { width: 800, height: 600 };
    const bounds = calculateBounds(smallScreen.width, smallScreen.height, false);

    assert.strictEqual(bounds.width, SIZES.full.width);
    assert.strictEqual(bounds.height, SIZES.full.height);
    assert.strictEqual(bounds.x, 10);
    assert.strictEqual(bounds.y, 274);
  });
});
