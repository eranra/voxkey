// VoxKey key-state helper (Windows).
//
// The Windows twin of scripts/keystate.swift: VoxKey's global shortcuts fire only when a key
// goes down, but "hold to talk" also needs the release. This helper installs a low-level
// keyboard hook (which needs no permission on Windows) and prints one line per press and
// release, in the same protocol as the macOS helper:
//
//   down <name>
//   up <name>
//
// The watched names must match src/shortcutManager.js. Build with (see
// scripts/build-keyhelper.js and the CI workflows):
//
//   csc /target:exe /out:bin\keystate-windows.exe native\keystate.cs
//
// Optionally pass --suppress <name>: events of that one key are then swallowed, so the key
// does not reach other applications (a right Alt held for dictation would otherwise open
// menu bars when released).

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace VoxKey
{
    class Program
    {
        // The keys we report. Virtual-key codes: F5-F12 and the right-side modifier keys.
        static readonly Dictionary<ushort, string> Watched = new Dictionary<ushort, string>
        {
            { 0x74, "f5" }, { 0x75, "f6" }, { 0x76, "f7" }, { 0x77, "f8" },
            { 0x78, "f9" }, { 0x79, "f10" }, { 0x7A, "f11" }, { 0x7B, "f12" },
            { 0xA5, "rightcontrol" }, { 0xA1, "rightshift" }, { 0xA4, "rightalt" }, { 0x5C, "rightwin" }
        };

        static string suppress = null;

        struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int ptX;
            public int ptY;
        }

        delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetModuleHandle(IntPtr lpModuleName);

        [DllImport("user32.dll")]
        static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);

        static IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32(); // WM_KEYDOWN=0x0100, WM_KEYUP=0x0101, WM_SYSKEYDOWN=0x0104, WM_SYSKEYUP=0x0105
                bool down = msg == 0x0100 || msg == 0x0104;
                bool up = msg == 0x0101 || msg == 0x0105;
                if (down || up)
                {
                    KBDLLHOOKSTRUCT data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                    if (Watched.TryGetValue((ushort)data.vkCode, out string name))
                    {
                        Console.WriteLine((down ? "down " : "up ") + name);
                        Console.Out.Flush();
                        // Swallowing is the last thing we do, so the line is already out.
                        if (suppress != null && name == suppress) return (IntPtr)1;
                    }
                }
            }
            return (IntPtr)0; // Let everything else through untouched.
        }

        // The delegate must be referenced for as long as the hook lives, or the garbage
        // collector may collect it while Windows still calls it.
        static readonly LowLevelKeyboardProc Hook = HookProc;

        static int Main(string[] args)
        {
            for (int i = 0; i + 1 < args.Length; i++)
            {
                if (args[i].Equals("--suppress", StringComparison.OrdinalIgnoreCase)) suppress = args[i + 1].ToLowerInvariant();
            }

            // A low-level hook must live on a thread that pumps messages; GetMessage blocks
            // forever and delivers the hook callbacks.
            var hook = SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, Hook, GetModuleHandle(IntPtr.Zero), 0);
            if (hook == IntPtr.Zero)
            {
                Console.Error.WriteLine("keystate: could not install the keyboard hook");
                return 1;
            }
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
            return 0;
        }
    }
}
