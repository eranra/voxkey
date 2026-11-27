const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const normalize = (svg) => svg.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();

describe('Compact mode toggle icon', () => {
  const html = read('renderer/index.html');
  const app = read('renderer/app.js');

  const initialIcon = normalize(/<svg id="compact-icon"[^>]*>([\s\S]*?)<\/svg>/.exec(html)?.[1] ?? '');
  const micGlyph = [...(/<svg class="mic-icon"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '')
    .matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  // The handler assigns two icons: [0] expands back from compact mode, [1] collapses to it.
  const assigned = [...app.matchAll(/compactIcon\.innerHTML = '([^']+)';/g)].map((m) => normalize(m[1]));

  it('the collapse button shows the compact bar in miniature: a mic inside a pill', () => {
    assert.match(initialIcon, /fill-rule="evenodd" d="M9 4h6a8 8 0 0 1 8 8/, 'pill ring');
    assert.match(initialIcon, /transform="translate\(6 6\.25\) scale\(0\.5\)"/, 'mic at half scale');
    assert.ok(micGlyph.length === 2, 'mic button glyph not found');
    for (const d of micGlyph) {
      assert.ok(initialIcon.includes(d), 'the pill must reuse the mic button glyph');
    }
  });

  it('the toggle restores exactly the icon the page starts with', () => {
    assert.strictEqual(assigned.length, 2);
    assert.strictEqual(assigned[1], initialIcon);
  });

  it('expanding back from compact mode shows the keyboard', () => {
    assert.match(assigned[0], /M20 5H4c-1\.1 0-1\.99\.9/, 'keyboard glyph');
  });

  it('the tooltip matches the icon the button shows', () => {
    const initialTitle = /id="minimize-btn"[^>]*title="([^"]+)"/.exec(html)?.[1];
    const titles = [...app.matchAll(/minimizeBtn\.title = "([^"]+)";/g)].map((m) => m[1]);
    assert.strictEqual(titles[1], initialTitle);
    assert.strictEqual(titles[0], 'Expand to Full Keyboard');
  });
});
