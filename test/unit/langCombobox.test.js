// Tests for the custom in-DOM language combobox.
// Ensures that language selection works on both Windows and macOS,
// even under Electron's `focusable: false` window constraint.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { LANGUAGES, DEFAULT_LANGUAGE } = require('../../renderer/languages');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('language combobox DOM structure in index.html', () => {
  const html = read('renderer/index.html');

  it('contains the language dropdown wrapper with button, label, menu and select', () => {
    assert.match(html, /id="lang-dropdown-wrapper"/, 'wrapper present');
    assert.match(html, /id="lang-btn"/, 'trigger button present');
    assert.match(html, /id="lang-btn-text"/, 'label span present');
    assert.match(html, /id="lang-menu"[^>]*role="listbox"[^>]*hidden/, 'menu present with role=listbox and hidden');
    assert.match(html, /id="lang-select"[^>]*style="display:\s*none;?"/, 'accessible select present and hidden');
  });

  it('trigger button has accessible attributes', () => {
    assert.match(html, /id="lang-btn"[^>]*aria-haspopup="listbox"/);
    assert.match(html, /id="lang-btn"[^>]*aria-expanded="false"/);
  });

  it('select element contains all supported languages in order', () => {
    const options = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(options, Object.keys(LANGUAGES));
  });
});

describe('language combobox interactive behavior', () => {
  const languagesSource = read('renderer/languages.js');
  const appSource = read('renderer/app.js');

  function makeEl(extra = {}) {
    const el = {
      children: [],
      style: {},
      className: '',
      textContent: '',
      title: '',
      value: '',
      onclick: null,
      onchange: null,
      hidden: false,
      attributes: {},
      childrenQueries: [],
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener() {},
      setAttribute(name, value) {
        this.attributes[name] = String(value);
        this[name] = value;
      },
      getAttribute(name) {
        return this.attributes[name] !== undefined ? this.attributes[name] : this[name];
      },
      querySelectorAll(selector) {
        if (selector === '.lang-option') {
          return this.children.filter((c) => (c.className || '').includes('lang-option'));
        }
        return [];
      },
      closest() {
        return null;
      }
    };
    el.classList = {
      add: (...names) => {
        const cur = el.className ? el.className.split(/\s+/) : [];
        el.className = [...cur, ...names.filter((n) => !cur.includes(n))].join(' ');
      },
      remove: (...names) => {
        const cur = el.className ? el.className.split(/\s+/) : [];
        el.className = cur.filter((n) => !names.includes(n)).join(' ');
      },
      toggle: (name, force) => {
        const cur = el.className ? el.className.split(/\s+/) : [];
        const has = cur.includes(name);
        const shouldHave = force !== undefined ? Boolean(force) : !has;
        if (shouldHave && !has) el.className = [...cur, name].join(' ');
        else if (!shouldHave && has) el.className = cur.filter((n) => n !== name).join(' ');
      }
    };
    let innerHTML = '';
    Object.defineProperty(el, 'innerHTML', {
      get: () => innerHTML,
      set: (value) => {
        innerHTML = value;
        el.children = [];
      }
    });
    return Object.assign(el, extra);
  }

  function setupPage(initialLang = 'en-US') {
    const els = {};
    const byId = (id) => els[id] || (els[id] = makeEl());

    els['lang-select'] = makeEl({
      value: initialLang,
      options: Object.keys(LANGUAGES).map((code) => ({
        value: code,
        text: code === 'en-US' ? 'EN (US)' : code
      }))
    });
    els['lang-btn'] = makeEl({ hidden: false });
    els['lang-btn-text'] = makeEl({ textContent: 'EN (US)' });
    els['lang-menu'] = makeEl({ hidden: true });
    els['row-1'] = makeEl();
    els['row-2'] = makeEl();
    els['row-3'] = makeEl();
    els['row-4'] = makeEl();

    const setLanguageCalls = [];
    const document = {
      getElementById: byId,
      querySelector: () => makeEl(),
      createElement: () => makeEl(),
      addEventListener() {}
    };

    const sandbox = {
      console: { log() {}, warn() {} },
      setTimeout: () => 0,
      clearTimeout: () => {},
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      document,
      voxkey: {
        injectText() {},
        injectKey() {},
        toggleVoice() {},
        setLanguage: (lang) => setLanguageCalls.push(lang),
        resizeWindow() {},
        hideToTray() {},
        closeApp() {},
        openAbout() {},
        getInfo: () => Promise.resolve({ version: '0.3.8', language: initialLang, voiceMode: 'toggle' }),
        onVoiceState() {},
        onSpeechUpdate() {},
        onVoiceError() {},
        onAudioLevel() {},
        onVoiceMode() {},
        onPermissions() {},
        openPermissionSettings() {}
      }
    };
    sandbox.window = sandbox;

    vm.runInNewContext(languagesSource, sandbox);
    vm.runInNewContext(appSource, sandbox);

    return { els, sandbox, setLanguageCalls };
  }

  it('clicking lang-btn opens the custom menu and populates all languages', () => {
    const { els } = setupPage();
    assert.strictEqual(els['lang-menu'].hidden, true);

    // Click trigger button to open
    els['lang-btn'].onclick();
    assert.strictEqual(els['lang-menu'].hidden, false);
    assert.ok(els['lang-btn'].className.includes('open'));
    assert.strictEqual(els['lang-btn'].getAttribute('aria-expanded'), 'true');

    // Menu contains options for every supported language
    const options = els['lang-menu'].children;
    assert.strictEqual(options.length, Object.keys(LANGUAGES).length);

    // Click again to close
    els['lang-btn'].onclick();
    assert.strictEqual(els['lang-menu'].hidden, true);
    assert.ok(!els['lang-btn'].className.includes('open'));
  });

  it('selecting a language updates the button text, select value, and notifies the backend', () => {
    const { els, setLanguageCalls } = setupPage();

    // Open menu
    els['lang-btn'].onclick();
    const hebrewOption = els['lang-menu'].children.find((c) => c.getAttribute('data-value') === 'he-IL');
    assert.ok(hebrewOption, 'Hebrew option should exist in custom menu');

    // Select Hebrew
    hebrewOption.onclick();

    // Menu closes
    assert.strictEqual(els['lang-menu'].hidden, true);
    // Button label and select updated
    assert.strictEqual(els['lang-btn-text'].textContent, 'he-IL');
    assert.strictEqual(els['lang-select'].value, 'he-IL');
    // api.setLanguage was called
    assert.ok(setLanguageCalls.includes('he-IL'));
    // Hebrew keyboard row rendered (Hebrew has 'ק' on row 1)
    const row1Keys = els['row-1'].children.map((k) => k.textContent);
    assert.ok(row1Keys.includes('ק'), 'Hebrew layout rendered on keyboard body');
  });

  it('programmatic lang-select onchange synchronizes with the custom button', () => {
    const { els, setLanguageCalls } = setupPage();

    els['lang-select'].value = 'es-ES';
    els['lang-select'].onchange({ target: { value: 'es-ES' } });

    assert.strictEqual(els['lang-btn-text'].textContent, 'es-ES');
    assert.ok(setLanguageCalls.includes('es-ES'));
  });
});
