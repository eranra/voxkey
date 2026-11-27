# How VoxKey works

VoxKey is an [Electron](https://www.electronjs.org/) app. The main process (Node.js) owns the windows, the tray
icon, the global shortcuts, typing into other apps, and update checks. The pages (keyboard and About window) run
without Node.js and talk to the main process only through `renderer/preload.js`.

## Voice typing

Electron has no speech recognition of its own, so VoxKey uses Google Chrome's Web Speech API:

1. `src/speechServer.js` starts an HTTP and WebSocket server on `127.0.0.1:19876`.
2. It starts Chrome with a separate profile and `--app=http://127.0.0.1:19876/stt.html`, in a small window
   (`bridgeArgs()` in `src/speechServer.js`).
3. `stt.html` connects back over WebSocket. On F8, the server sends `{command: 'start', lang}`; the page sends
   `status`, `speech_result` (interim and final text), `speech_error`, `bridge_state` (visible or hidden) and
   `audio_level` (microphone loudness, 0..1, about ten times a second while listening).
4. The keyboard shows "Listening" only after the page confirms with `status: listening`. Without a confirmation
   within 4 seconds, VoxKey reports `bridge-no-response` and restarts the bridge.
5. Final text goes to the injector, which types it into the focused app.

### Microphone modes

The tray menu's **Voice Typing Mode** offers two behaviors, saved with the other settings in `src/store.js`:

- **Toggle** (default): the microphone stays on until the user stops it.
- **Stops after silence**: the microphone also stops by itself. `stt.html` measures the microphone while
  listening (`getUserMedia` + `AnalyserNode`, separate from the Web Speech API) and reports `audio_level`;
  recognized text counts as speech too. `src/speechServer.js` stops the recording after 2 seconds without
  speech, but never before speech was heard at all — so a pause before you start speaking does not end it.
  If the level measuring fails, dictation still works and silence detection falls back to speech results.

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
| `stt.html` | Speech page that runs in Chrome. |
| `scripts/ensure-electron.js` | Downloads the Electron binary when npm skipped it. |
| `test/` | Unit and integration tests (`node --test`). |
