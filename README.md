# VoxKey

A modern, fast, cross-platform on-screen keyboard (OSK) with real-time cloud speech-to-text dictation for Windows and macOS.

Current Version: **v0.0.5**

---

## 📦 Install

Requirements: Node.js and npm. Google Chrome is used for speech recognition.

```bash
npm ci
npm run setup     # downloads and unpacks the Electron binary
npm start         # or: npm run start:minimized
```

`npm start` also runs the setup step, so `npm run setup` is optional. The setup step is needed because
newer npm versions block Electron's own install script, and on newer Node versions that script can stop
before it finishes unpacking.

### macOS

- Start VoxKey with `npm start` or `npm run start:minimized`. The `.vbs` and `.bat` launchers are Windows-only.
- **Accessibility permission:** VoxKey types into other apps through System Events (`osascript`).
  Allow your terminal app (or Electron) in System Settings → Privacy & Security → Accessibility.
  Without this permission, no text is typed.
- **Microphone permission:** dictation runs in Chrome, so allow microphone access for Chrome when asked.

---

## 🚀 Launch Options (No Black Console Windows)

We provide silent background Windows launchers so no terminal or console window is displayed:

| File | Behavior |
| :--- | :--- |
| **`run.vbs`** | **Silent Launch:** Opens VoxKey directly on screen with **zero** black terminal or npm window. |
| **`run_minimized.vbs`** | **Background / Minimized Launch:** Starts silently directly into the System Tray (near the clock). Press **`F8`** to dictate or click the tray icon to show. |
| **`run.bat`** | **Console Launch:** Shows debug logs in terminal. |

---

## 🛡️ Single-Instance Lock & Smart Version Takeover

- **No Duplicate Instances:** Starting VoxKey again while it's already running will **never** spawn duplicate processes.
- **Same Version:** If you launch the same version, it simply reveals your existing VoxKey window (`showInactive()`) without stealing keyboard focus.
- **Newer Version Handover:** If you launch a newer version (e.g. `v0.0.6` while `v0.0.5` is running), the older instance gracefully shuts down and hands over control so the new version takes over immediately.

### Version Bumping
You can bump versions anytime with the built-in npm commands:
```bash
npm run bump:patch    # e.g., 0.0.5 -> 0.0.6
npm run bump:minor    # e.g., 0.0.6 -> 0.1.0
```

---

## ⌨️ Controls & Shortcuts

- **`F8`** or **`Ctrl + Shift + Space`**: Toggle voice typing from anywhere (even when minimized in background).
- **Chevron `▼`**: Collapse into the draggable, floating voice pill.
- **Keyboard `⌨`**: Expand floating pill back to full on-screen keyboard.
- **Minus `—`**: Minimize to System Tray (taskbar near clock).
- **Close `✕`**: Quit VoxKey.
