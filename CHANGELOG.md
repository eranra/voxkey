# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-27

### Added

- **A second microphone behavior: stop after silence.** *Voice Typing Mode* in the tray menu now offers
  *Toggle* (the previous behavior: on until you press the mic or F8 again) and *Stops after silence* (press
  once; VoxKey stops by itself about two seconds after you stop speaking). Nothing stops before the first
  speech, so you can pause before you start talking. Chrome restarting its recognizer mid-dictation does not
  reset that clock, and a microphone that stays loud for about ten seconds without any recognized speech
  (a noisy room) ends the recording too. A small clock badge on the microphone button marks the
  mode, and the setting is remembered between sessions.
- **The microphone indicator follows your voice.** While recording, the microphone glyph is replaced by four
  level bars that grow and shrink with the live loudness of your voice, and the ring around the button scales
  with it too. Before, both showed a fixed animation that did not react to sound.

### Changed

- **Compact mode button:** a mic in a pill (the compact floating bar in miniature) instead of a bare down chevron.
  The button now shows its destination, like the keyboard icon that expands back from compact mode.

## [0.1.1] - 2026-11-27

The first release with installers for Windows and macOS. Version 0.1.0 was not published; its changes are
part of this release.

### Added

- **Installers for Windows and macOS.** `npm run dist` builds a one-click Windows installer (x64 and Arm) and
  macOS `.dmg` files (Apple silicon and Intel). A GitHub Actions workflow builds them for every `v*` tag and
  attaches them to a draft release.
- **Updates from GitHub.** VoxKey checks for a new version on start and every 6 hours, or on request with
  *Check for Updates…*. Windows downloads and installs the update on restart. macOS shows the release and a
  one-line update command. Automatic checks can be turned off in the tray menu.
- **About VoxKey window** with the version, system, update status, a *Check for Updates* button and links to
  GitHub. Open it from the tray menu or by clicking the logo.
- **macOS installer script** (`install.sh`): install, update, build from source, or uninstall.
- **CI on Windows and macOS** for every pull request: syntax check, tests, the Windows helper compiled from
  source, and a packaging dry run.
- VoxKey remembers the dictation language between sessions.
- `npm run setup` downloads the Electron binary when npm blocked Electron's own install script.

### Fixed

- **Security:** any web page open in a browser could connect to VoxKey's local WebSocket and make VoxKey type
  text into the focused app. Only VoxKey's own speech page can connect now. The takeover and show commands
  need a header that web pages cannot send.
- Starting a newer version while an older one runs now really starts the newer version. Before, the older one
  quit, but the newer one never opened its window or tray icon, so VoxKey disappeared and a hidden process
  stayed behind.
- macOS: keystrokes could arrive out of order when keys were pressed quickly. They now run one at a time.
- macOS: Hebrew, Arabic, Russian, Chinese and other non-ASCII text could not be typed. It is now pasted
  through the clipboard, and the previous clipboard text is restored.
- macOS: the tray icon was shown at its full 1024 px size in the menu bar.
- Windows: non-English text sent to the typing helper could arrive garbled, because the helper read its
  input with the console code page instead of UTF-8.
- The keyboard window ignored the position of the display's work area (the macOS menu bar, or a primary
  display that does not start at the top-left corner).
- Pressing the microphone button while Chrome was still starting could start a second Chrome process.
- Malformed messages from the speech page could crash the main process.
- VoxKey could freeze after *Check for Updates…*: on macOS the result message is modal and blocks the app
  until it is closed, and the always-on-top keyboard covered it. Update messages now appear as a sheet on
  the About window, above the keyboard, and VoxKey keeps working while they are open.
- **Voice typing showed "Listening" but typed nothing**, from time to time. Chrome delivers no speech
  results while the bridge page is hidden, and on macOS it counts a window as hidden when other windows
  cover it; the tiny bridge window was often covered. Chrome now starts with options that keep a covered
  window running (`--disable-backgrounding-occluded-windows` and related). In addition:
  - the keyboard shows "Listening" only after the bridge confirms that recognition runs; if it does not
    confirm within 4 seconds, VoxKey shows an error and restarts the bridge;
  - the bridge refuses to start while it is really hidden (for example minimized) and says why;
  - errors are shown in the keyboard (microphone blocked, no network, no microphone, ...), and a
    `no-speech` pause is no longer treated as an error;
  - a reconnect of the bridge no longer creates a second recognizer.
- *Check for Updates…* did nothing when an automatic check was running at the same time. The manual
  request now waits for that check and shows its result.

### Changed

- **New icon:** the waveform logo on a dark rounded square (the same shape as Big Eyes) with transparent corners,
  instead of a white square. The macOS menu bar uses a template icon that follows light and dark mode, and
  Windows uses a colored tray icon. `npm run icons` draws all of them (`scripts/make-icons.js`).
- The keyboard window runs without Node.js access, with context isolation and a small preload API.
  Pages have a Content Security Policy.
- Electron 33 → 44.9.0. Removed the unused `simple-keyboard` dependency.
- `npm run bump:patch` / `bump:minor` now use `npm version`, so `package-lock.json` stays in sync.

## [0.0.5] - 2026-11-27

- First public version: on-screen keyboard with voice typing, compact floating mode, tray icon,
  single-instance lock with version takeover.
