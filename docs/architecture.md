# How VoxKey works

VoxKey is an [Electron](https://www.electronjs.org/) app. The main process (Node.js) owns the windows, the tray
icon, the global shortcuts, typing into other apps, and update checks. The pages (keyboard and About window) run
without Node.js and talk to the main process only through `renderer/preload.js`.

## Voice typing

Electron has no speech recognition of its own, so VoxKey uses Google Chrome's Web Speech API:

0. **Permissions are checked, not assumed** (`src/permissions.js`). On macOS every reinstall of the
   unsigned (ad-hoc signed) app is a new identity, so the Accessibility and Microphone grants can
   vanish; typing and dictation would then fail silently. The app checks both at startup and when
   the user presses a key or starts dictation, shows a warning bar in the keyboard window, opens
   the matching system settings pane, and reports failed typing commands (a non-zero osascript
   exit) instead of swallowing them. On Windows the global microphone privacy switch is read from
   the registry before dictation starts.
1. `src/speechServer.js` starts an HTTP and WebSocket server on `127.0.0.1:19876`.
2. It starts Chrome with a separate profile and `--app=http://127.0.0.1:19876/stt.html`, in a small window
   (`bridgeArgs()` in `src/speechServer.js`). The profile directory is created fresh on every launch
   (`launchChromeBridge()`): a long-lived profile once got into a state where the speech recognizer
   ended every session instantly, without any error, while the microphone itself kept working
   (macOS, 2026-11-28). Leftover directories from earlier launches are removed after a day.
3. `stt.html` connects back over WebSocket. On F8, the server sends `{command: 'start', lang}`; the page sends
   `status`, `speech_result` (interim and final text), `speech_error`, `bridge_state` (visible or hidden),
   `audio_level` (microphone loudness, 0..1, about ten times a second while listening) and `levels_error`
   (the loudness cannot be measured; dictation itself may still work).
4. The keyboard shows "Listening" only after the page confirms with `status: listening`. Without a confirmation
   within 4 seconds, VoxKey reports `bridge-no-response` and restarts the bridge.
5. Final text goes to the injector, which types it into the focused app.

**A "listening" bridge whose microphone delivers nothing is detected.** After the bridge confirms
`listening`, it must show within a few seconds that audio flows: an `audio_level`, a `speech_result`, or a
`levels_error` notice. If nothing arrives (`MIC_STUCK_TIMEOUT_MS` in `src/speechServer.js`), VoxKey reports
`mic-stuck`, stops the recording and replaces the bridge. Without this, a stuck macOS audio state made
VoxKey show "Listening (speak now)" forever while typing nothing (observed 2026-11-28, after Chrome
processes were killed while an audio stream was opening; restarting the audio daemon `coreaudiod`
also clears that state).

### Microphone modes

The tray menu's **Voice Typing Mode** offers two behaviors, saved with the other settings in `src/store.js`:

- **Toggle** (default): the microphone stays on until the user stops it.
- **Stops after silence**: the microphone also stops by itself. `stt.html` measures the microphone while
  listening (`getUserMedia` + `AnalyserNode`, separate from the Web Speech API) and reports `audio_level`;
  recognized text counts as speech too. `src/speechServer.js` stops the recording after 2 seconds without
  speech, but never before speech was heard at all — so a pause before you start speaking does not end it.
  A `listening` confirmation that arrives while already recording (Chrome restarts its recognizer after a
  pause) is not a new recording, so it does not restart that clock. A microphone that stays loud for about
  10 seconds without any recognized speech counts as noise, and the recording then ends too — without this
  guard, a noisy room would keep it on forever. If the level measuring fails, dictation still works and
  silence detection falls back to speech results.

The same levels drive the keyboard's microphone indicator: while recording, four bars replace the microphone
glyph and follow the live loudness, and the ring around the button scales with the voice. Without level data,
the bars keep a gentle idle motion.

**Chrome gives no speech results while the page is hidden.** On macOS, Chrome counts a window as hidden when
other windows cover it, and the bridge window is usually covered. `bridgeArgs()` therefore passes
`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`,
`--disable-background-timer-throttling` and `--disable-features=CalculateNativeWinOcclusion`. If the page is
still hidden (minimized), it answers a start with `speech_error: page-hidden` instead of pretending to listen.
`test/unit/speechBridge.test.js` covers all of this, including the real `stt.html` script.

Only VoxKey's own page may open the WebSocket (`isTrustedRequest` checks the `Origin` and `Sec-Fetch-Site`
headers). Without this check, any web site could make VoxKey type into your apps.

## Languages

The language list in the keyboard header drives both the keyboard and the recognition:

- `renderer/languages.js` is the one registry: for every language it holds the keyboard rows, the
  space-bar label in the language's own script, and whether it is right-to-left. The page loads it
  as a plain script; the tests load it as a module. Rows are written in visual left-to-right order;
  right-to-left languages keep their letters at the physical positions of the national layout and
  mirror only the action keys (backspace and enter at the left end), like mobile keyboards. Hebrew
  and Arabic have no uppercase, so they have no shift key and no uppercase variant.
- Changing the language persists it (`set-lang` → `src/store.js`) and re-renders the keyboard.
- `src/speechServer.js` sends the language with every start command. Chrome applies
  `recognition.lang` only when a session starts, so `setLanguage` re-broadcasts the start command
  while dictation runs: `stt.html` then ends the running session and its `onend` auto-restart
  brings it back in the new language.

## Typing into other apps

`src/injectorManager.js`:

- **Windows:** `bin/injector.exe` (source: `native/injector.cs`) runs for the whole session and reads commands on
  stdin: `TEXT:<text>`, `KEY:<name>`, `HIDE_BRIDGE`. It types with `SendInput` and `KEYEVENTF_UNICODE`, so every
  language works.
- **macOS:** AppleScript through `osascript` and System Events. Commands run one at a time, in order.
  `keystroke` only types characters on the current keyboard layout, so non-ASCII text is pasted (Cmd+V) and the
  clipboard is restored afterwards.

The keyboard window is not focusable, so clicking its keys never takes the focus from the app you type into.

## One copy at a time

`main.js` asks Electron for the single-instance lock. A second copy asks the first one (`/api/status`) for its
version. If the second copy is newer, it calls `/api/takeover`; the old copy quits, and the new one waits for
the lock and starts. Otherwise it calls `/api/show` and quits. The two commands need the `x-voxkey-client`
header, which a web page cannot send without a CORS preflight that VoxKey never allows.

## Updates

- `src/update.js` — logic without Electron: version comparison, which update method each system uses, release
  URLs, reading `latest*.yml`. Fully unit tested.
- `src/updater.js` — the check itself. Windows uses
  [electron-updater](https://www.electron.build/auto-update) (download, then install on restart). macOS
  downloads `latest-mac.yml` from the newest release and tells the user, because automatic install on macOS needs
  an Apple Developer ID signature. The Electron parts are passed in, so tests use fakes.
- `electron-builder.yml` publishes to the same repository, and writes `app-update.yml` into the Windows app.

## Files

| Path | What it is |
| :--- | :--- |
| `main.js` | Starts everything and connects the parts. |
| `src/config.js` | Version, port, paths, window sizes. |
| `src/windowManager.js` | Keyboard window: placement, compact mode, secure page settings. |
| `src/trayManager.js` | Tray menu (built as plain data by `buildTrayMenuModel`, so it is testable). |
| `src/aboutWindow.js` | About window. |
| `src/store.js` | Settings saved as JSON in the user data folder. |
| `src/speechServer.js` | Local server and Chrome speech bridge. |
| `src/injectorManager.js` | Typing on Windows and macOS. |
| `src/instanceManager.js` | Single instance and version takeover. |
| `src/update.js`, `src/updater.js` | Update checks. |
| `renderer/` | Keyboard and About pages, and the preload API. |
| `renderer/languages.js` | The language registry: keyboard rows, names, text direction. |
| `stt.html` | Speech page that runs in Chrome. |
| `scripts/ensure-electron.js` | Downloads the Electron binary when npm skipped it. |
| `test/` | Unit and integration tests (`node --test`). |
