# Language-aware keyboard and voice — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The language combo box switches the on-screen keyboard layout and the speech-recognition language, including an immediate switch during active dictation.

**Architecture:** A new registry `renderer/languages.js` (loadable as a browser script and from Node) is the single source of truth for each language's rows, native name and RTL flag. `renderer/app.js` renders from it. `stt.html` and `src/speechServer.js` get a small change so a language change mid-session restarts recognition in the new language.

**Tech Stack:** Plain JavaScript (no bundler), Electron renderer without Node access, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-27-language-keyboard-and-voice-design.md`

## Global Constraints

- No new npm dependencies.
- The keyboard page has no Node.js access; data reaches it only through a `<script src>` file (CSP `script-src 'self'`).
- Keep the existing IPC channels and message formats; only the documented behavior of `setLanguage` grows.
- Tests: `node --test`, existing files in `test/unit/`; lint: `npm run lint` (syntax check).
- No AI-authorship lines in commits; author is Eran Raichstein.

## Review Focus

- A saved language from `settings.json` that is not in the registry (hand-edited file, or a future option) must fall back to the default layout, not a blank keyboard. → Task 2 test: unknown language falls back to `en-US` rows.
- `switchLayout('upper')` must never render `undefined` rows for languages without an `upper` variant. → Task 1 test: `layouts.upper || layouts.lower` is used (registry test: caseless have no `upper`; renderer wiring test).
- A language change while dictating must not leave the recognizer stopped if the restart fails: the existing `onend` restart and error paths stay intact. → Task 3 tests: still listening after restart, one recognizer.
- Changing the language while a start is still unconfirmed must not stack a second start timer. → Task 4 test: no extra timer, broadcast carries the new language.
- Row density: no row may exceed 14 keys, or the 840 px window squeezes keys below a usable size (14 is needed by Spanish row 3, which carries all five acute vowels; see the spec's row-width note). → Task 1 registry test.

---

### Task 1: Language registry (`renderer/languages.js`)

**Files:**
- Create: `renderer/languages.js`
- Test: `test/unit/keyboardLayouts.test.js`

**Interfaces:**
- Produces: global `VoxKeyLanguages` in the browser; `module.exports = { LANGUAGES, DEFAULT_LANGUAGE }` in Node.
  `LANGUAGES` maps a BCP-47 tag (the `<option>` value) to `{ name: string, rtl: boolean, layouts: { lower, upper?, symbols, alt_symbols } }`,
  where each variant is an array of 4 rows and each row is an array of strings or `{ action, label }` objects
  (same actions as today: shift, backspace, space, enter, symbols, alt_symbols, abc).

- [ ] **Step 1: Write the failing tests**

```js
// test/unit/keyboardLayouts.test.js
const { LANGUAGES, DEFAULT_LANGUAGE } = require('../../renderer/languages');
const fs = require('fs');
const path = require('path');

// Option values in renderer/index.html must match the registry exactly.
function selectOptions() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
  return [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}
```

Tests (assert style of the existing suite, `node:test` + `node:assert`):
1. `selectOptions()` deep-equals `Object.keys(LANGUAGES)` (order included).
2. Every language, for every variant it defines: 4 rows, each row 1–13 keys, every key a string or an object with a string `label`.
3. Row 4 of `lower` has exactly one `{action:'space'}`; row 3 of `lower` has exactly one `{action:'backspace'}`.
4. `he-IL` lower rows contain exactly the 27 Hebrew letters (set comparison: קראטוןםפ שדגכעיחלךף זסבהנמצתץ).
5. `ru-RU` lower rows contain all 33 Cyrillic letters; `layouts.upper` exists and has the same letters uppercased.
6. `ar-SA` lower rows contain the 28 base letters plus ء ة ئ ؤ ى.
7. `de-DE` contains ä ö ü ß; `fr-FR` rows 1–2 are AZERTY (`a z e r t y...`, `q s d f g h...`); `es-ES` contains ñ á é í ó ú.
8. `he-IL` and `ar-SA` have `rtl: true`, no `shift` key in any row, and no `upper` variant; all others `rtl: false` and have a `shift` key plus an `upper` variant.
9. RTL row 3 starts with backspace and row 4 starts with `{action:'enter'}` (mirrored actions); LTR row 3 starts with shift.
10. `zh-CN` shares the `en-US` layout object (same reference) and `DEFAULT_LANGUAGE === 'en-US'`.
11. The shared symbols variant contains `/` and the alt_symbols variant contains `¿` and `¡`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/unit/keyboardLayouts.test.js`
Expected: FAIL — `Cannot find module '../../renderer/languages'`.

- [ ] **Step 3: Implement `renderer/languages.js`**

UMD guard (`module.exports` when defined, else `window.VoxKeyLanguages`), then the data. Layouts per the spec table; shared `SYMBOLS`/`ALT_SYMBOLS` objects referenced by every language. English QWERTY rows move here unchanged from `renderer/app.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/unit/keyboardLayouts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/languages.js test/unit/keyboardLayouts.test.js
git commit -m "Add the language registry with a layout per language"
```

### Task 2: Renderer wiring

**Files:**
- Modify: `renderer/index.html` (script tag)
- Modify: `renderer/app.js` (replace `LAYOUTS`, language state, space-bar label)
- Test: `test/unit/keyboardLayouts.test.js` (append)

**Interfaces:**
- Consumes: `VoxKeyLanguages.LANGUAGES`, `VoxKeyLanguages.DEFAULT_LANGUAGE` (Task 1).

- [ ] **Step 1: Write the failing tests (append to `test/unit/keyboardLayouts.test.js`)**

1. `renderer/index.html` contains `<script src="languages.js"></script>` before `<script src="app.js"></script>`.
2. `renderer/app.js` no longer defines a top-level `const LAYOUTS = {` (grep) and references `VoxKeyLanguages` and `setKeyboardLanguage`.
3. Source-level contract: `app.js` contains a fallback for unknown languages (e.g. a `DEFAULT_LANGUAGE` reference) and reads the space-bar label from the registry `name`, not from the select options.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/unit/keyboardLayouts.test.js`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

`index.html`: add the script tag. `app.js`: replace `LAYOUTS` with registry lookup; add `currentLangKey`; `setKeyboardLanguage(lang)` validates against `LANGUAGES` (fallback `DEFAULT_LANGUAGE`), resets `currentLayout`/`isShift`, re-renders; `renderKeyboard()` uses `layouts[currentLayout] || layouts.lower` and the registry `name` for the space bar; `langSelect.onchange` calls `api.setLanguage` then `setKeyboardLanguage`; the startup `getInfo` restore calls `setKeyboardLanguage` too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/unit/keyboardLayouts.test.js && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/app.js test/unit/keyboardLayouts.test.js
git commit -m "Render the keyboard from the selected language's layout"
```

### Task 3: Mid-session language switch in the bridge page

**Files:**
- Modify: `stt.html` (`startListening`)
- Test: `test/unit/speechBridge.test.js` (append to `bridge page` describe)

**Interfaces:**
- Consumes: the existing WebSocket `start`/`stop` protocol; `startListening(lang)` signature unchanged.

- [ ] **Step 1: Write the failing test**

In the `loadBridgePage` sandbox: `page.receive({command:'start', lang:'en-US'})`; assert running; `page.receive({command:'start', lang:'he-IL'})`; assert `page.recognition.lang === 'he-IL'`, still running, still one recognizer, and the last sent message is `{type:'status', status:'listening'}`. Also: a `start` with the *same* language while running must not restart (no second `onstart`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/speechBridge.test.js`
Expected: FAIL — `recognition.lang` stays `'en-US'` (start() throws, old code only confirms).

- [ ] **Step 3: Implement**

In `startListening`: track `langChanged` (truthy lang different from `currentLang`); set `currentLang` and `recognition.lang` first (as today). In the `catch` of `recognition.start()`: when `langChanged`, `recognition.stop()` (the `onend` handler restarts with the new language, because `isListening` stays true); otherwise confirm listening as today.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/speechBridge.test.js`
Expected: PASS (all bridge tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add stt.html test/unit/speechBridge.test.js
git commit -m "Restart bridge recognition when the language changes mid-session"
```

### Task 4: `setLanguage` re-broadcast while dictating

**Files:**
- Modify: `src/speechServer.js` (`setLanguage`)
- Test: `test/unit/speechServer.test.js` (append)

**Interfaces:**
- Consumes: Task 3 behavior (the bridge restarts on a repeated `start` with a new lang).
- Produces: `setLanguage(lang)` — unchanged signature; new behavior: broadcasts `{command:'start', lang}` when the language changes and (`isRecording` or a start is pending).

- [ ] **Step 1: Write the failing tests**

Use the real WebSocket server pattern from `test/unit/speechServer.test.js` (or the handshake block in `speechBridge.test.js`): connect a client; `toggleVoice('en-US')`; confirm listening; `setLanguage('he-IL')`; assert the client received a second `{command:'start', lang:'he-IL'}` and `server.isRecording` is still true. Then `setLanguage` while idle sends nothing to the client.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/unit/speechServer.test.js`
Expected: FAIL — no second `start` is broadcast.

- [ ] **Step 3: Implement**

In `setLanguage`: `const changed = Boolean(lang) && lang !== this.currentLang; this.currentLang = lang; if (changed && (this.isRecording || this.startTimer)) this.broadcast({ command: 'start', lang: this.currentLang });`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/unit/speechServer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/speechServer.js test/unit/speechServer.test.js
git commit -m "Switch dictation to a new language immediately on language change"
```

### Task 5: Documentation and changelog

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `CHANGELOG.md`

- [ ] **Step 1: Update docs**

`CHANGELOG.md`: new `## [Unreleased]` → `### Added` entries (language layouts incl. RTL Hebrew/Arabic; recognition follows the language, also mid-dictation). `docs/architecture.md`: a "Languages" section (registry, layout selection, mid-session restart) and a `renderer/languages.js` row in the Files table. `README.md`: update the feature list sentence about the keyboard/language if one exists.

- [ ] **Step 2: Commit**

```bash
git add README.md docs/architecture.md CHANGELOG.md
git commit -m "Document the language-aware keyboard and voice feature"
```

### Task 6: Full check, push, PR

- [ ] **Step 1:** `npm run check` (lint + all unit + integration tests) — expected PASS.
- [ ] **Step 2:** Push the branch and open a PR with `gh pr create` (base `main`, title in the repo's sentence style, body summarizing the two behaviors and the layouts table).
