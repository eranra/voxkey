# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.11] - 2026-11-28

### Fixed

- **Hebrew (and other non-ASCII) dictation types into your app again (macOS).** Non-ASCII text
  is pasted through the clipboard, and the previous clipboard content was restored after only
  300 ms — busy applications (browsers, WhatsApp, Slack, VS Code) process the paste later than
  that and pasted nothing: the words appeared in the keyboard but never reached the target,
  while English (typed as direct keystrokes) kept working. The restore now waits 1.5 seconds,
  and never overwrites a clipboard the user changed in the meantime.

## [0.3.10] - 2026-11-28

### Fixed

- **Microphone permission and voice typing on Windows.** On Windows, desktop apps do not require
  macOS-style TCC prompts. The registry check in `microphoneState` now safely handles process exit
  and stream closing, only reporting `denied` if Windows microphone access is explicitly blocked in
  Settings, and defaulting to `granted` otherwise.
- **Prevented false mic permission warnings on toggle.** `handleToggleVoice` and startup permission
  checks now only invoke macOS `askMicrophone()` on `darwin`, ensuring non-macOS platforms are not
  falsely set to `denied` when `requestMicrophoneAccess` returns `unavailable`.
- **Eliminated `page-hidden` error in speech bridge.** Removed `ShowWindow(SW_HIDE)` call on Windows
  which was causing Chrome's `document.hidden` to become `true` and breaking Web Speech API recognition.
  The speech bridge remains off-screen (`-10000, -10000`) and fully functional.

## [0.3.9] - 2026-11-28

### Fixed

- **Language combobox works reliably on Windows and macOS.** The native HTML `<select>`
  popup menu was blocked on Windows due to the non-focusable window constraint (`focusable: false`).
  Replaced with an elegant in-DOM dropdown menu that opens smoothly, displays native language names,
  and syncs two-way with the underlying language registry.
- **Removed redundant close button from header.** Quitting VoxKey is cleanly managed through
  the system tray context menu, avoiding accidental keyboard dismissals.
- **Fixed test suite assertion ordering on Windows.** Injector integration tests now properly
  stop the helper before asserting exit state.

## [0.3.8] - 2026-11-28

### Fixed

- **The on-screen keyboard types into your app again (macOS).** On newer macOS versions,
  clicking the keyboard window activates VoxKey even though the window is not focusable: every
  key press stole the focus, and the typed characters landed in the keyboard itself. Dictation
  was unaffected, because speaking does not touch the mouse. VoxKey now follows the app you are
  working in and re-activates it before every keystroke, so clicked keys land where you were
  typing — for keyboard clicks and dictation alike.

## [0.3.7] - 2026-11-28

### Fixed

- **The on-screen keyboard no longer stops typing into other apps.** While a permission dialog
  was open, a second request could leave the keyboard window focusable; every key click then
  stole the focus and the typed characters landed in the keyboard itself. The permission focus
  requests now run one after another, always restore the not-focusable state, and hand keyboard
  focus back. Restarting VoxKey also clears a stuck state.

## [0.3.6] - 2026-11-28

### Fixed

- **The microphone dialog finally appears (macOS).** The app runs under the hardened runtime but
  its entitlements were missing `com.apple.security.device.audio-input`; without it macOS denies
  audio input silently — no permission dialog, no entry in the Microphone list, and dictation
  receives silence no matter what is allowed in System Settings. With the entitlement, the first
  dictation start shows the real "VoxKey would like to access the microphone" dialog.

## [0.3.5] - 2026-11-28

### Fixed

- **The permission warning clears by itself once access is granted.** Before, the "Open
  Settings" warning stayed in the keyboard until the app was restarted, even after the switch
  in System Settings was flipped. While a permission is missing it is now re-checked every
  three seconds.

## [0.3.4] - 2026-11-28

### Fixed

- **The microphone permission prompt now actually appears.** macOS shows its prompts only on the
  app's active window; VoxKey's keyboard window is deliberately not focusable (so clicks never
  steal focus from the app being typed into), so every microphone request was denied silently
  and VoxKey never appeared in the Microphone list. The window now takes focus briefly while
  the system asks, and gives it back afterwards. The startup request also waits for the window
  to exist instead of firing before it.

## [0.3.3] - 2026-11-28

### Fixed

- **A crashed speech bridge now restarts by itself.** A Chrome crash left voice typing dead until
  the whole app was restarted; the bridge is now replaced automatically after three seconds.

## [0.3.2] - 2026-11-28

### Fixed

- **macOS: the Accessibility guidance now opens the right pane on every macOS version.** Newer
  releases renamed and reorganized the privacy panes, so the hard-coded link landed where the
  setting could not be found. VoxKey now asks macOS itself to open the pane for the current
  build. Also note: an allowed VoxKey row from an earlier install does not help a newer one
  (unsigned builds change identity on every install) — the warning bar and the pane stay until
  the current build is allowed.

## [0.3.1] - 2026-11-28

### Added

- **VoxKey now tells you when macOS permissions are missing, instead of failing silently.**
  Every reinstall of the unsigned app needs fresh Accessibility and Microphone grants; before,
  key presses and dictation then did nothing, with no explanation. Now:
  - the keyboard shows a red warning bar ("VoxKey cannot type: allow it in Privacy & Security >
    Accessibility", and the same for the microphone) with an **Open Settings** button;
  - pressing a key or starting dictation with a missing permission opens the matching system
    settings pane (the macOS privacy panes, the Windows microphone privacy page);
  - the permissions are also checked at startup, and a typing command that fails mid-run
    (permission revoked, osascript error) is reported instead of being swallowed;
  - dictation refuses to start while the microphone is denied, with instructions, instead of
    listening to silence.
  On Windows, the global "Let desktop apps access your microphone" switch is checked before
  dictation starts.

## [0.3.0] - 2026-11-28

The multi-language release. Everything below, including the changes listed under 0.2.0, ships in
this version; 0.2.0 was never published on its own.

### Added

- **The keyboard follows the selected language.** Choosing a language in the header list now swaps
  the on-screen keys to that language's layout: QWERTY for English, QWERTZ with umlauts for German,
  AZERTY with é è à ç for French, ñ and acute vowels for Spanish, the standard Hebrew layout
  (right-to-left, backspace and enter mirrored to the left), the standard Arabic layout, and the
  Russian ЙЦУКЕН layout. Chinese keeps the Latin keys for pinyin input through the system IME.
  The space bar names the language in its own script (עברית, Español, Русский, ...).
- **Voice recognition follows the selected language immediately.** Before, the recognizer kept the
  language of the session that was already running; Chrome applies a language only when a session
  starts. Changing the language while dictating now restarts recognition in the new language
  without leaving the listening state.

### Fixed

- **macOS: dictation could show "Listening" forever while typing nothing.** Three causes, all fixed:
  - **VoxKey now asks for microphone access itself.** macOS attributes the microphone use of the
    speech bridge — a Chrome process that VoxKey starts — to VoxKey. Without the permission the
    bridge receives silent audio and no error: the mic indicator moves, but nothing is ever typed.
    VoxKey now shows the system's microphone prompt once, at first launch.
  - The Chrome profile that the speech bridge reuses got into a state where the speech recognizer
    ended every session instantly, without any error, while the microphone itself kept working.
    The bridge now gets a fresh profile directory on every launch, so a broken profile cannot
    persist; leftover directories are cleaned up after a day.
  - When the audio pipeline is stuck (observed when Chrome processes are killed while an audio
    stream is opening), the bridge keeps confirming "listening" but nothing arrives. VoxKey now
    notices within a few seconds, shows "The microphone is not responding", and replaces the
    speech bridge so the next press of the mic works.

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
