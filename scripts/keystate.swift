// VoxKey key-state helper (macOS).
//
// VoxKey sends keystrokes and reads the keyboard state through this small compiled helper,
// because Electron's global shortcuts fire only when a key goes down: "hold to talk" also
// needs the release. The helper polls the key state about thirty times a second and prints
// one line per change:
//
//   down <name>
//   up <name>
//
// Key-state polling needs no permission (unlike event taps, which would require Input
// Monitoring). Build with:
//
//   swiftc -O scripts/keystate.swift -o bin/keystate-macos
//
// The names must match the keys in src/shortcutManager.js.

import CoreGraphics
import Foundation

let watched: [CGKeyCode: String] = [
  96: "f5", 97: "f6", 98: "f7", 100: "f8", 101: "f9", 109: "f10", 103: "f11", 111: "f12",
  61: "rightoption", 54: "rightcommand", 62: "rightcontrol", 60: "rightshift"
]

var last: [String: Bool] = [:]

while true {
  for (code, name) in watched {
    let down = CGEventSource.keyState(.combinedSessionState, key: code)
    if last[name] != down {
      last[name] = down
      print(down ? "down \(name)" : "up \(name)")
      fflush(stdout)
    }
  }
  usleep(30000) // 30 ms
}
