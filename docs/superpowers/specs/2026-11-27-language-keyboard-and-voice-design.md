# Language-aware keyboard and voice — design

## Intent

The language combo box must drive the whole app, not only the space-bar label:

1. The on-screen keyboard shows the layout of the selected language (Hebrew letters for Hebrew, AZERTY for French, and so on).
2. Google speech recognition follows the selected language, and a change while dictating takes effect immediately.

## Goals

- Every language offered in the combo box (en-US, en-GB, es-ES, fr-FR, de-DE, he-IL, ar-SA, ru-RU, zh-CN) has a keyboard layout and a speech-recognition locale.
- Changing the language re-renders the keyboard at once and resets shift/symbol state.
- Changing the language while dictating restarts recognition in the new language without losing the "Listening" state.
- The choice is persisted (already true today via `settings.json`).

## Non-goals

- A Chinese input method (IME). zh-CN keeps the Latin QWERTY keys for pinyin; the OS IME converts them in the target app. Voice recognition works in Chinese.
- Long-press accent variants (as on phone keyboards). Each language's common special letters are plain keys instead.
- Hebrew nikud (vowel points), Arabic hamza variants (أ إ آ) and rare accents (ê, ü for Spanish). Voice typing covers these.
- Right-to-left mirroring of the transcript box.

## Layouts (verified against the standard national layouts)

All rows are data in visual left-to-right order, in the mobile 4-row form the keyboard already uses
(row 1–3 letters, row 4: symbols switch, comma, space, period, enter). RTL languages keep the
letters at their physical positions and mirror only the action keys, like iOS/Android Hebrew and
Arabic keyboards: backspace and enter at the left end, the ?123 key at the right end.

| Language | Layout | Special letters |
| :--- | :--- | :--- |
| en-US, en-GB | QWERTY (today's rows) | — |
| de-DE | QWERTZ (iOS-style rows) | ü ö ä ß |
| fr-FR | AZERTY | é è à ç (row 3) |
| es-ES | QWERTY | ñ (row 2), á é í ó ú (row 3) |
| he-IL | Standard Israeli (SI-1452) letters, no shift key | all 27 letters incl. finals |
| ar-SA | Standard Arabic 101 letters, no shift key | all 28 letters + ء ة ئ ؤ ى |
| ru-RU | ЙЦУКЕН | all 33 letters incl. ё, with shift for uppercase |
| zh-CN | QWERTY (pinyin) | — |

The symbols and alt-symbols layers stay shared by all languages; `¿` and `¡` join the shared
alt-symbols layer, and `/` joins the shared symbols layer.

## Approach

- **One registry, two environments.** `renderer/languages.js` maps each combo-box value to
  `{ name, rtl, layouts }`. It loads as a plain `<script>` in the keyboard page (CSP allows
  `script-src 'self'`) and exports the same object to Node for unit tests (UMD-style guard).
  This is the single source of truth for what a language looks like.
- **Renderer wiring.** `app.js` keeps the selected language in a variable, renders rows from
  the registry, falls back to `lower` for missing variants (caseless scripts have no `upper`),
  and labels the space bar with the registry's native name (עברית, Español, ...).
- **Immediate recognition-language switch.** Chrome applies `recognition.lang` only when a
  session starts. Two small changes fix the mid-session gap:
  - `stt.html`: a `start` command with a changed language ends the running session
    (`recognition.stop()`); the existing `onend` auto-restart brings it back in the new language.
  - `speechServer.setLanguage()`: when the language changes while a start is pending or
    dictation is confirmed, it broadcasts `{command: 'start', lang}` again.

## Tests

- `test/unit/keyboardLayouts.test.js` (new): registry integrity — every `<option>` in
  `renderer/index.html` has a registry entry and vice versa; every variant has exactly 4
  non-empty rows; exactly one space key; Hebrew covers all 27 letters, Russian all 33, Arabic
  its letter set; caseless languages have no shift key and no `upper` variant; RTL languages
  mirror the action keys; cased languages have matching uppercase rows.
- `test/unit/speechBridge.test.js` (extended): a `start` with a new language mid-session
  restarts the same recognizer with the new `recognition.lang` and stays listening.
- `test/unit/speechServer.test.js` (extended): `setLanguage` while recording re-broadcasts a
  `start` with the new language; while idle it does not.
