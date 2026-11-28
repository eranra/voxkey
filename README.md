<div align="center">

# ⌨️ VoxKey

**An on-screen keyboard with real-time voice typing. Works on Windows and macOS.**

[![CI](https://github.com/eranra/voxkey/actions/workflows/ci.yml/badge.svg)](https://github.com/eranra/voxkey/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-supported-0078D6?logo=windows)
![macOS](https://img.shields.io/badge/macOS-supported-black?logo=apple)

[Install](#-install) · [Use it](#-use-it) · [Updates](#-updates) · [Permissions](#-macos-permissions) · [Build from source](#-build-from-source)

</div>

---

VoxKey floats a small keyboard at the bottom of your screen. Click its keys, or press **F8** and speak:
VoxKey types what you say into the app you are using — your editor, browser, chat or terminal.
It never takes the keyboard focus away from that app.

## 💻 Windows and macOS

VoxKey is built and tested on both systems. Every change runs the test suite on Windows and on macOS
in CI, and every release has installers for both.

| | Windows 10 / 11 | macOS 12 or newer |
| :--- | :--- | :--- |
| **Installer** | `VoxKey-Setup-<version>.exe` (x64 and Arm) | `VoxKey-<version>-arm64.dmg` (Apple silicon) and `-x64.dmg` (Intel) |
| **How it types** | A small native helper (`bin/injector.exe`, source in `native/injector.cs`) sends keystrokes through the Windows `SendInput` API. All languages are supported. | AppleScript through System Events. ASCII text is typed key by key; other text (Hebrew, Arabic, Russian, Chinese, emoji) is pasted, and your clipboard is restored afterwards. |
| **Updates** | Downloaded in the background and installed on restart. | VoxKey tells you about the new version and gives you a one-line update command. |
| **Where it lives** | System tray (near the clock) | Menu bar |
| **Voice typing** | Google Chrome must be installed (it provides speech recognition). | Google Chrome must be installed (it provides speech recognition). |
| **Permissions** | None | Accessibility, and Automation for System Events. [Details](#-macos-permissions) |

## 🚀 Install

### Windows

1. Download `VoxKey-Setup-<version>.exe` from the [Releases page](https://github.com/eranra/voxkey/releases/latest).
2. Run it. It installs in one click and starts VoxKey.
3. If SmartScreen appears ("Windows protected your PC"), choose **More info → Run anyway**. This appears because the
   installer is not code-signed.

### macOS — one line

Open **Terminal** and paste:

```sh
curl -fsSL https://raw.githubusercontent.com/eranra/voxkey/main/install.sh | bash
```

The script downloads the latest version for your Mac, puts **VoxKey** in your Applications folder, and starts it.
Then give VoxKey the [permissions](#-macos-permissions) it needs to type.

<details>
<summary>Prefer to drag and drop?</summary>

1. Download `VoxKey-<version>-arm64.dmg` (Apple silicon) or `VoxKey-<version>-x64.dmg` (Intel) from the
   [Releases page](https://github.com/eranra/voxkey/releases/latest).
2. Open it and drag **VoxKey** onto **Applications**.
3. Open VoxKey. macOS says it "could not be verified", because the app is not signed by a registered Apple
   developer. Choose **Done**, then open **System Settings → Privacy & Security**, scroll down to
   "VoxKey was blocked…", and click **Open Anyway**. This is needed once. The one-line installer avoids it.

</details>

### Uninstall

- **Windows:** Settings → Apps → VoxKey → Uninstall.
- **macOS:** `curl -fsSL https://raw.githubusercontent.com/eranra/voxkey/main/install.sh | bash -s -- --uninstall`,
  or drag the app to the Trash.

## ⌨️ Use it

| Action | How |
| :--- | :--- |
| Start or stop voice typing, from any app | **F8**, or **Ctrl + Shift + Space** (**Cmd + Shift + Space** on macOS), or the microphone button |
| Choose the microphone behavior | **Voice Typing Mode** in the tray menu: *Toggle* (on until you press again) or *Stops after silence* (stops by itself about two seconds after you stop speaking). The mic button shows a small clock badge in the second mode. |
| Choose the dictation language | The language list in the keyboard header (EN, ES, FR, DE, HE, AR, RU, ZH). The keyboard switches to that language's layout, voice recognition switches with it, and VoxKey remembers it. |
| Collapse to a small floating pill | Chevron **▼** |
| Expand the pill back to the keyboard | Keyboard **⌨** |
| Hide to the tray / menu bar | Minus **—** |
| Quit | **Quit VoxKey** in the tray menu |
| About, version and updates | Click the VoxKey logo, or **About VoxKey** in the tray menu |

Only one VoxKey runs at a time. Starting it again shows the running keyboard. Starting a **newer** version
replaces the older one that is running.

## 🔄 Updates

VoxKey checks GitHub for a new version 10 seconds after it starts and then every 6 hours. You can also check
at any time with **Check for Updates…** in the tray menu or the About window. To turn automatic checks off,
clear **Check for Updates Automatically** in the tray menu.

- **Windows:** the update downloads in the background. Choose **Restart Now** to install it, or it installs the
  next time VoxKey quits.
- **macOS:** you get a message with a link to the new release and a **Copy Update Command** button. Paste the
  command in Terminal to update.
- **Running from source** (`npm start`): no update checks. Use `git pull`.

The update check contacts only `github.com` (and GitHub's download server). It sends no personal data.

## 🔐 macOS permissions

To type into other apps, macOS must allow VoxKey to control your computer:

1. **Accessibility:** System Settings → Privacy & Security → **Accessibility** → turn on **VoxKey**.
   When you run from source, turn on your terminal app (or **Electron**) instead.
2. **Automation:** the first time VoxKey types, macOS asks whether VoxKey may control **System Events**.
   Choose **Allow**. You can change it later in System Settings → Privacy & Security → **Automation**.
3. **Microphone:** dictation runs in Chrome, so allow microphone access for Chrome when asked.

If keys do nothing on macOS, one of the first two permissions is missing.

## ❓ Troubleshooting

- **Voice typing does not start:** install Google Chrome. VoxKey starts a hidden Chrome window for speech
  recognition. On Windows it looks in `Program Files` and `%LOCALAPPDATA%`; on macOS in `/Applications` and
  `~/Applications`.
- **The log says "Could not start on port 19876":** another program uses VoxKey's local port, so voice typing
  cannot start. Close that program. VoxKey listens only on `127.0.0.1`, so the port is not reachable from
  other computers.
- **F8 does not work:** another app has registered F8 as a global shortcut. Use **Ctrl/Cmd + Shift + Space**.

## 🛠️ Build from source

You need [Node.js](https://nodejs.org/) 20 or newer. Google Chrome is needed for voice typing.

```sh
git clone https://github.com/eranra/voxkey.git
cd voxkey
npm ci
npm start                 # run it (also downloads the Electron binary if needed)
npm run start:minimized   # start hidden in the tray / menu bar

npm run check             # syntax check and tests
npm run dist              # build an installer for this system into ./dist
npm run icons             # redraw the app and tray icons in ./assets
./install.sh --from-source   # macOS: build and install into /Applications
```

`npm start` first runs `npm run setup`. That step downloads and unpacks the Electron binary when it is
missing, because newer npm versions block Electron's own install script.

On Windows you can also start from source without a console window: `run.vbs` (shows the keyboard) or
`run_minimized.vbs` (starts in the tray). `run.bat` shows the log in a console window.

To rebuild the Windows typing helper from `native/injector.cs` (Windows only, uses the .NET Framework compiler):

```sh
npm run build:injector
```

How the parts fit together: [docs/architecture.md](docs/architecture.md).
How to publish a new version: [docs/releasing.md](docs/releasing.md).

## 📄 License

VoxKey is open source under the [MIT License](LICENSE).
