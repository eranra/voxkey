const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { appIcon, gradient, onWave, png } = require('../../scripts/make-icons');

const assets = path.join(__dirname, '..', '..', 'assets');

/** Reads width, height and color type from a PNG header. */
function pngInfo(file) {
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.toString('latin1', 1, 4), 'PNG', file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

describe('icons', () => {
  it('the app icon is 1024 px with transparency, as electron-builder needs', () => {
    assert.deepStrictEqual(pngInfo(path.join(assets, 'icon.png')), { width: 1024, height: 1024, colorType: 6 });
  });

  it('tray icons have 1x and 2x sizes', () => {
    for (const name of ['tray', 'trayTemplate']) {
      assert.strictEqual(pngInfo(path.join(assets, `${name}.png`)).width, 16, name);
      assert.strictEqual(pngInfo(path.join(assets, `${name}@2x.png`)).width, 32, name);
    }
  });

  it('the app icon has transparent corners and a dark background, not white', () => {
    assert.strictEqual(appIcon(0.01, 0.01)[3], 0, 'corner is transparent');
    const [r, g, b, a] = appIcon(0.5, 0.15);
    assert.strictEqual(a, 1);
    assert.ok(r < 80 && g < 80 && b < 100, `background ${r},${g},${b} is dark`);
  });

  it('the waveform keeps the logo colors, pink on the left and teal on the right', () => {
    const [lr, , lb] = gradient(0);
    const [rr, rg] = gradient(1);
    assert.ok(lr > 200 && lb < 140, 'left is pink');
    assert.ok(rg > 180 && rr < 100, 'right is teal');
    assert.ok(onWave(0.37, 0), 'tallest bar at the center line');
    assert.ok(onWave(0.83, 0), 'first dot');
    assert.ok(!onWave(0.83, 0.2), 'nothing above the dots');
  });

  it('the PNG encoder writes a valid image', () => {
    const data = png(4, () => [255, 0, 0, 1], 1);
    const idat = data.subarray(data.indexOf('IDAT') + 4, data.indexOf('IEND') - 8);
    const raw = zlib.inflateSync(idat);
    assert.strictEqual(raw.length, 4 * (4 * 4 + 1));
    assert.deepStrictEqual([...raw.subarray(1, 5)], [255, 0, 0, 255]);
  });
});
