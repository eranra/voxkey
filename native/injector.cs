using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace VoxKey
{
    class Program
    {
        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct INPUTUNION
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT
        {
            public uint type;
            public INPUTUNION u;
        }

        const uint INPUT_KEYBOARD = 1;
        const uint KEYEVENTF_KEYDOWN = 0x0000;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;
        const int SW_HIDE = 0;

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        public static void HideBridgeWindow()
        {
            EnumWindows((hWnd, lParam) =>
            {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (title.IndexOf("VoxKey Speech Bridge", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    ShowWindow(hWnd, SW_HIDE);
                }
                return true;
            }, IntPtr.Zero);
        }

        static void SendChar(char c)
        {
            INPUT[] inputs = new INPUT[2];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].u.ki.wVk = 0;
            inputs[0].u.ki.wScan = (ushort)c;
            inputs[0].u.ki.dwFlags = KEYEVENTF_UNICODE;
            inputs[0].u.ki.time = 0;
            inputs[0].u.ki.dwExtraInfo = IntPtr.Zero;

            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].u.ki.wVk = 0;
            inputs[1].u.ki.wScan = (ushort)c;
            inputs[1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            inputs[1].u.ki.time = 0;
            inputs[1].u.ki.dwExtraInfo = IntPtr.Zero;

            uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent == 0)
            {
                if (c >= 'a' && c <= 'z')
                {
                    byte vk = (byte)(c - 32);
                    keybd_event(vk, 0, 0, UIntPtr.Zero);
                    keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
                else if (c >= 'A' && c <= 'Z')
                {
                    keybd_event(0x10, 0, 0, UIntPtr.Zero);
                    keybd_event((byte)c, 0, 0, UIntPtr.Zero);
                    keybd_event((byte)c, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                    keybd_event(0x10, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
                else if (c == ' ')
                {
                    keybd_event(0x20, 0, 0, UIntPtr.Zero);
                    keybd_event(0x20, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
            }
        }

        static void SendVk(ushort vk)
        {
            INPUT[] inputs = new INPUT[2];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].u.ki.wVk = vk;
            inputs[0].u.ki.wScan = 0;
            inputs[0].u.ki.dwFlags = KEYEVENTF_KEYDOWN;
            inputs[0].u.ki.time = 0;
            inputs[0].u.ki.dwExtraInfo = IntPtr.Zero;

            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].u.ki.wVk = vk;
            inputs[1].u.ki.wScan = 0;
            inputs[1].u.ki.dwFlags = KEYEVENTF_KEYUP;
            inputs[1].u.ki.time = 0;
            inputs[1].u.ki.dwExtraInfo = IntPtr.Zero;

            uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent == 0)
            {
                keybd_event((byte)vk, 0, 0, UIntPtr.Zero);
                keybd_event((byte)vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            }
        }

        static void ProcessCommand(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            if (line.StartsWith("TEXT:"))
            {
                string text = line.Substring(5);
                foreach (char c in text)
                {
                    SendChar(c);
                    Thread.Sleep(2);
                }
            }
            else if (line.StartsWith("KEY:"))
            {
                string key = line.Substring(4).Trim().ToUpper();
                switch (key)
                {
                    case "BACKSPACE":
                    case "BKSP":
                        SendVk(0x08);
                        break;
                    case "ENTER":
                        SendVk(0x0D);
                        break;
                    case "TAB":
                        SendVk(0x09);
                        break;
                    case "SPACE":
                        SendVk(0x20);
                        break;
                    case "ESCAPE":
                    case "ESC":
                        SendVk(0x1B);
                        break;
                }
            }
            else if (line.Trim().ToUpper() == "HIDE_BRIDGE")
            {
                HideBridgeWindow();
            }
        }

        static void Main(string[] args)
        {
            if (args.Length >= 1)
            {
                if (args[0] == "--hide-bridge")
                {
                    HideBridgeWindow();
                    return;
                }
                if (args.Length >= 2)
                {
                    if (args[0] == "--text") ProcessCommand("TEXT:" + args[1]);
                    else if (args[0] == "--key") ProcessCommand("KEY:" + args[1]);
                }
                return;
            }

            // Stream mode: read commands continuously from standard input
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                ProcessCommand(line);
            }
        }
    }
}
