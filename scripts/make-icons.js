#!/usr/bin/env node
// Generates VoxKey's icons as PNG files, without any image library. Run: npm run icons
//   assets/icon.png                     1024 px app icon (electron-builder makes the .icns and .ico from it)
//   assets/trayTemplate.png / @2x       macOS menu bar: black + alpha; macOS tints it for light and dark mode
//   assets/tray.png / @2x               Windows tray: the colored waveform on a transparent background
//
// The picture: a sound wave (five rounded bars on a thin line) followed by two dots, colored
// pink → purple → blue → teal, on a dark rounded square like the keyboard window.
const { deflateSync } = require('zlib');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'assets');

// ---- PNG encoding -------------------------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Renders `pixel(u, v) -> [r, g, b, alpha 0..1]` (u, v in 0..1) into a size × size RGBA PNG. */
function png(size, pixel, samples = 4) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const n = samples * samples;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // Supersampling for smooth edges. Colors are weighted by alpha.
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const p = pixel((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
          r += p[0] * p[3];
          g += p[1] * p[3];
          b += p[2] * p[3];
          a += p[3];
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- The waveform ------------------------------------------------------------------------------
// Coordinates are in "wave units": x from 0 (left edge of the first bar) to 1 (right edge of the last
// dot), y = 0 on the center line. Measured from the original 1024 px logo (content 640 px wide).

const W = 640;
const BAR_HALF_WIDTH = 31 / W;
const BARS = [
  { x: 30.5, top: 435, bottom: 588 },
  { x: 131.5, top: 374, bottom: 649 },
  { x: 237, top: 325, bottom: 698 },
  { x: 342, top: 405, bottom: 618 },
  { x: 447.5, top: 435, bottom: 588 }
].map((b) => ({ x: b.x / W, top: (b.top - 511.5) / W, bottom: (b.bottom - 511.5) / W }));
const LINE_HALF_HEIGHT = 9 / W;
const DOTS = [532 / W, 612 / W];
const DOT_RADIUS = 28 / W;

/** Height of the waveform in wave units (top of the tallest bar to its bottom). */
const WAVE_HEIGHT = BARS[2].bottom - BARS[2].top;

/**
 * Whether the point is on the waveform. `thick` makes thin parts bolder for small tray icons;
 * `line` = false leaves out the thin line between the bars.
 */
function onWave(x, y, { thick = 0, line = true } = {}) {
  const hw = BAR_HALF_WIDTH + thick;
  for (const bar of BARS) {
    const dx = Math.abs(x - bar.x);
    if (dx > hw) continue;
    // A capsule: a rectangle with half-circle ends.
    const top = bar.top + hw;
    const bottom = bar.bottom - hw;
    if (y >= top && y <= bottom) return true;
    const cy = y < top ? top : bottom;
    if (Math.hypot(x - bar.x, y - cy) <= hw) return true;
  }
  if (line && x >= BARS[0].x && x <= BARS[4].x && Math.abs(y) <= LINE_HALF_HEIGHT + thick / 2) return true;
  for (const dx of DOTS) if (Math.hypot(x - dx, y) <= DOT_RADIUS + thick) return true;
  return false;
}

/** The logo's left-to-right gradient, sampled from the original logo. */
const STOPS = [
  [0.0, [238, 106, 120]],
  [0.17, [210, 87, 154]],
  [0.36, [190, 76, 204]],
  [0.6, [185, 76, 207]],
  [0.68, [138, 112, 213]],
  [0.79, [95, 160, 217]],
  [0.92, [78, 192, 214]],
  [1.0, [72, 204, 200]]
];

function gradient(x) {
  const t = Math.min(1, Math.max(0, x));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Maps icon coordinates (u, v in 0..1) to wave units, with the wave `width` wide and centered. */
function toWave(u, v, width) {
  return { x: (u - 0.5) / width + 0.5, y: (v - 0.5) / width };
}

// ---- App icon -----------------------------------------------------------------------------------

function appIcon(u, v) {
  // Rounded square, the same shape as Big Eyes (6% margin, 20% corner radius).
  const m = 0.06;
  const r = 0.2;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0);
  if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];

  const { x, y } = toWave(u, v, 0.66);
  if (onWave(x, y)) return [...gradient(x), 1];

  // Dark background like the keyboard window, slightly violet at the top, with a soft glow behind the wave.
  const glow = Math.max(0, 1 - Math.hypot((u - 0.5) / 0.42, (v - 0.5) / 0.3)) ** 2 * 0.22;
  const base = [44 - 22 * v, 40 - 18 * v, 64 - 30 * v];
  const tint = [150, 70, 190];
  return [...base.map((c, i) => Math.round(c + (tint[i] - c) * glow)), 1];
}

// ---- Tray icons ---------------------------------------------------------------------------------

/** Tray icons show the wave only, as large as fits; thin parts are made bolder so they stay visible. */
function trayShape(u, v) {
  const { x, y } = toWave(u, v, 0.94);
  return onWave(x, y, { thick: 0.012, line: true });
}

const template = (u, v) => (trayShape(u, v) ? [0, 0, 0, 1] : [0, 0, 0, 0]);
const tray = (u, v) => (trayShape(u, v) ? [...gradient(toWave(u, v, 0.94).x), 1] : [0, 0, 0, 0]);

// ---- Write --------------------------------------------------------------------------------------

function main() {
  fs.mkdirSync(dir, { recursive: true });
  const files = [
    ['icon.png', png(1024, appIcon)],
    ['trayTemplate.png', png(16, template, 8)],
    ['trayTemplate@2x.png', png(32, template, 8)],
    ['tray.png', png(16, tray, 8)],
    ['tray@2x.png', png(32, tray, 8)]
  ];
  for (const [name, data] of files) fs.writeFileSync(path.join(dir, name), data);
  console.log(`Icons written to ${dir}: ${files.map(([n]) => n).join(', ')}`);
}

if (require.main === module) main();

module.exports = { appIcon, gradient, onWave, png, trayShape, WAVE_HEIGHT };
