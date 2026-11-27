// Tests for the microphone button in the keyboard page: the mode badge, and the live level
// indicator. The real renderer/app.js runs in a vm with a fake DOM, the same approach the
// bridge page tests use for stt.html.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'app.js'), 'utf8');
// app.js reads the language registry, which the real page loads before it (renderer/index.html).
const languagesSource = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'languages.js'), 'utf8');

/** A DOM element fake: enough of the API that app.js can load and render the keyboard. */
function makeEl(extra = {}) {
  const classes = new Set();
  return Object.assign(
    {
      children: [],
      style: {},
      classList: {
        add: (...names) => names.forEach((c) => classes.add(c)),
        remove: (...names) => names.forEach((c) => classes.delete(c)),
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name),
        _classes: classes
      },
      innerHTML: '',
      innerText: '',
      textContent: '',
      title: '',
      value: '',
      onclick: null,
      onchange: null,
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener() {},
      setAttribute(name, value) {
        this[name] = value;
      },
      querySelectorAll: () => []
    },
    extra
  );
}

/** Loads app.js with fakes; returns the page objects the test needs to poke at. */
function loadRendererPage({ voiceMode = 'toggle' } = {}) {
  const els = {};
  const byId = (id) => els[id] || (els[id] = makeEl());
  const bars = [makeEl(), makeEl(), makeEl(), makeEl()];

  els['lang-select'] = makeEl({
    options: [{ value: 'en-US', text: 'EN (US)' }],
    selectedIndex: 0
  });
  els['mic-levels'] = makeEl({ querySelectorAll: () => bars });

  const document = {
    getElementById: byId,
    querySelector: () => makeEl(),
    createElement: () => makeEl()
  };

  const listeners = {};
  const toggleCalls = [];
  const api = {
    injectText() {},
    injectKey() {},
    setLanguage() {},
    resizeWindow() {},
    hideToTray() {},
    closeApp() {},
    openAbout() {},
    toggleVoice: () => toggleCalls.push('toggle'),
    getInfo: () => Promise.resolve({ version: 'test', language: 'en-US', voiceMode }),
    onVoiceState: (fn) => (listeners.voiceState = fn),
    onSpeechUpdate: (fn) => (listeners.speechUpdate = fn),
    onVoiceError: (fn) => (listeners.voiceError = fn),
    onAudioLevel: (fn) => (listeners.audioLevel = fn),
    onVoiceMode: (fn) => (listeners.voiceMode = fn)
  };

  let frames = [];
  const requestAnimationFrame = (fn) => {
    frames.push(fn);
    return frames.length;
  };
  const cancelAnimationFrame = () => {
    frames = [];
  };

  const sandbox = {
    console: { log() {} },
    document,
    requestAnimationFrame,
    cancelAnimationFrame
  };
  sandbox.window = sandbox;
  sandbox.voxkey = api;

  vm.runInNewContext(languagesSource, sandbox);
  vm.runInNewContext(appSource, sandbox);

  const page = {
    els,
    bars,
    listeners,
    toggleCalls,
    get micBtn() {
      return els['mic-btn'];
    },
    get micWave() {
      return els['mic-wave'];
    },
    /** Runs animation frames, as the browser would; each frame may schedule the next. */
    runFrames(count, t0 = 0, step = 100) {
      for (let i = 0; i < count; i++) {
        const fn = frames.shift();
        if (!fn) break;
        fn(t0 + i * step);
      }
    },
    get pendingFrames() {
      return frames.length;
    },
    clearFrames() {
      frames = [];
    }
  };
  return page;
}

const scaleOf = (bar) => Number(bar.style.transform.replace(/^scaleY\((\d+\.\d+)\)$/, '$1'));

async function settled(page) {
  // Let getInfo()'s promise resolve and its callback run.
  await new Promise((r) => setTimeout(r, 0));
  return page;
}

describe('mic button', () => {
  it('pressing it toggles voice typing', () => {
    const page = loadRendererPage();
    page.micBtn.onclick();
    assert.deepStrictEqual(page.toggleCalls, ['toggle']);
  });

  it('shows the clock badge and a tooltip in until-silence mode, from the saved setting', async () => {
    const page = await settled(loadRendererPage({ voiceMode: 'until-silence' }));
    assert.strictEqual(page.micBtn.classList.contains('mode-until-silence'), true);
    assert.match(page.micBtn.title, /silence/);
    assert.match(page.micBtn['aria-label'], /silence/, 'screen readers hear the mode too');
  });

  it('toggle mode keeps the plain icon', async () => {
    const page = await settled(loadRendererPage({ voiceMode: 'toggle' }));
    assert.strictEqual(page.micBtn.classList.contains('mode-until-silence'), false);
    assert.strictEqual(page.micBtn.title, 'Voice Typing (F8)');
    assert.strictEqual(page.micBtn['aria-label'], 'Voice typing');
  });

  it('a mode change from the tray arrives live', async () => {
    const page = await settled(loadRendererPage({ voiceMode: 'toggle' }));
    page.listeners.voiceMode('until-silence');
    assert.strictEqual(page.micBtn.classList.contains('mode-until-silence'), true);
    page.listeners.voiceMode('toggle');
    assert.strictEqual(page.micBtn.classList.contains('mode-until-silence'), false);
    assert.strictEqual(page.micBtn.title, 'Voice Typing (F8)');
  });
});

describe('live level indicator', () => {
  it('recording starts the animation, and bars grow with the audio level', async () => {
    const page = await settled(loadRendererPage());
    page.listeners.voiceState('listening');
    assert.strictEqual(page.micBtn.classList.contains('recording'), true);
    assert.ok(page.pendingFrames >= 1, 'the animation runs while recording');

    page.runFrames(1, 0); // one frame with no level data: the gentle fallback motion
    const quiet = page.bars.map(scaleOf);

    page.listeners.audioLevel(0.95);
    page.runFrames(30, 1000); // enough frames to converge on the new level
    const loud = page.bars.map(scaleOf);

    assert.ok(loud.every((s, i) => s > quiet[i]), `bars rise with the voice: ${quiet} -> ${loud}`);
    assert.ok(scaleOf(page.bars[0]) > 0.8, 'a loud level fills the bars');
    assert.match(page.micWave.style.transform, /^scale\(1\.\d+\)$/, 'the ring grows with the voice too');
  });

  it('stopping resets the bars and stops the animation', async () => {
    const page = await settled(loadRendererPage());
    page.listeners.voiceState('listening');
    page.listeners.audioLevel(0.9);
    page.runFrames(20);
    assert.ok(scaleOf(page.bars[0]) > 0.5);

    page.listeners.voiceState('idle');
    assert.strictEqual(page.micBtn.classList.contains('recording'), false);
    assert.strictEqual(page.pendingFrames, 0, 'no frames left');
    for (const bar of page.bars) assert.strictEqual(scaleOf(bar), 0.2, 'bars back to rest');
    assert.strictEqual(page.micWave.style.transform, 'scale(1)');

    page.listeners.audioLevel(0.9); // a late level must not restart anything
    assert.strictEqual(page.pendingFrames, 0);
  });

  it('ignores level values that are not a number in 0..1', async () => {
    const page = await settled(loadRendererPage());
    page.listeners.voiceState('listening');
    page.listeners.audioLevel(1.5);
    page.listeners.audioLevel('loud');
    page.runFrames(30);
    // Only the fallback motion was available, so bars stay in its low range.
    assert.ok(scaleOf(page.bars[0]) < 0.6);
  });
});
