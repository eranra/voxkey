# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-27

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

### Changed

- The keyboard window runs without Node.js access, with context isolation and a small preload API.
  Pages have a Content Security Policy.
- Electron 33 → 44.9.0. Removed the unused `simple-keyboard` dependency.
- `npm run bump:patch` / `bump:minor` now use `npm version`, so `package-lock.json` stays in sync.

## [0.0.5] - 2026-11-27

- First public version: on-screen keyboard with voice typing, compact floating mode, tray icon,
  single-instance lock with version takeover.
