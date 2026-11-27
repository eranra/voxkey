const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const { PORT, PATHS, APP_VERSION } = require('./config');

/** Header that VoxKey's own instance checks send. A web page cannot add it without a CORS preflight, which we never allow. */
const CLIENT_HEADER = 'x-voxkey-client';
/** Longest text accepted in one speech message. */
const MAX_TEXT_LENGTH = 5000;
/** How long to wait for the bridge to confirm "listening" after a start, before reporting an error. */
const START_TIMEOUT_MS = 4000;

/**
 * Command-line options for the Chrome window that runs the speech bridge (stt.html).
 *
 * Chrome delivers no speech results while a page is hidden, and it counts a window as hidden when
 * other windows cover it (macOS), or computes the same on Windows ("native window occlusion"). The
 * bridge window is tiny and usually covered, so without the last four options dictation showed
 * "Listening" but nothing came back.
 */
function bridgeArgs(port, profileDir) {
  return [
    `--app=http://127.0.0.1:${port}/stt.html`,
    // Own profile: a separate Chrome process that never mixes with the user's own Chrome windows.
    `--user-data-dir=${profileDir}`,
    // Allow the microphone for our page without a permission prompt.
    '--use-fake-ui-for-media-stream',
    '--window-position=-10000,-10000',
    '--window-size=1,1',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    // Keep the page "visible" and running at full speed when it is covered or in the background.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'
  ];
}

/** Origins a browser may use to talk to this server: only our own bridge page. */
function allowedOrigins(port) {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/**
 * True when a request comes from VoxKey itself (our bridge page or another VoxKey process), not from
 * some web page in the user's browser. Browsers always send `Origin` on WebSocket connections and
 * `Sec-Fetch-Site` on modern requests; programs like Node.js send neither.
 */
function isTrustedRequest(req, port) {
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins(port).includes(origin)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

/** A short message for the keyboard window when voice typing fails. */
function voiceErrorText(error) {
  switch (error) {
    case 'page-hidden':
      return 'Voice typing could not start: the speech window is hidden. Press the mic again.';
    case 'bridge-no-response':
      return 'The speech service did not respond. It is restarting; press the mic again in a moment.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Chrome may not use the microphone. Allow it for Google Chrome in your system privacy settings.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Voice typing needs an internet connection (Chrome sends the audio to its speech service).';
    case 'not-supported':
      return 'Speech recognition is not available in this Chrome.';
    case 'language-not-supported':
      return 'This language is not supported for voice typing.';
    default:
      return `Voice typing stopped: ${error}`;
  }
}

/** Places where Google Chrome is usually installed on Windows and macOS. */
function chromeCandidates(env = process.env, home = os.homedir()) {
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA || '';
  const macApp = 'Google Chrome.app/Contents/MacOS/Google Chrome';
  return [
    path.win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.win32.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ...(localAppData ? [path.win32.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
    path.posix.join('/Applications', macApp),
    path.posix.join(home, 'Applications', macApp)
  ];
}

/** Returns a valid bridge message, or null. Protects the main process from malformed data. */
function parseBridgeMessage(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const text = (v) => (typeof v === 'string' ? v.slice(0, MAX_TEXT_LENGTH) : '');
  if (data.type === 'status' && typeof data.status === 'string') {
    return { type: 'status', status: data.status };
  }
  if (data.type === 'speech_result') {
    return { type: 'speech_result', interim: text(data.interim), final: text(data.final) };
  }
  if (data.type === 'speech_error') {
    return { type: 'speech_error', error: text(String(data.error ?? 'unknown')) };
  }
  if (data.type === 'bridge_state' && typeof data.visible === 'boolean') {
    return { type: 'bridge_state', visible: data.visible };
  }
  return null;
}

class SpeechServer {
  constructor(options = {}) {
    this.port = options.port || PORT;
    this.server = null;
    this.wss = null;
    this.clients = new Set();
    this.chromeProcess = null;
    // True only after the bridge confirmed "listening". The keyboard shows "Listening" only then.
    this.isRecording = false;
    // Set between a "start" and the bridge's confirmation.
    this.startTimer = null;
    this.startTimeoutMs = options.startTimeoutMs || START_TIMEOUT_MS;
    this.bridgeVisible = null;
    this.currentLang = 'en-US';

    // Callbacks
    this.onSpeechResult = options.onSpeechResult || (() => {});
    this.onSpeechStatus = options.onSpeechStatus || (() => {});
    this.onSpeechError = options.onSpeechError || (() => {});
    this.onTakeoverRequest = options.onTakeoverRequest || (() => {});
    this.onShowRequest = options.onShowRequest || (() => {});
    this.onBridgeConnect = options.onBridgeConnect || (() => {});
    this.onBridgeReady = options.onBridgeReady || null;

    // Replaceable in tests.
    this.spawn = options.spawn || spawn;
    this.fileExists = options.fileExists || fs.existsSync;
    this.chromePaths = options.chromePaths || null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleHttp(req, res));

      this.wss = new WebSocketServer({
        server: this.server,
        // Only our bridge page may connect. Any other web page could otherwise type into the user's apps.
        verifyClient: ({ req }) => {
          const ok = isTrustedRequest(req, this.port);
          if (!ok) console.warn(`[SpeechServer] Refused WebSocket from origin ${req.headers.origin}`);
          return ok;
        }
      });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        console.log(`[SpeechServer] Speech bridge connected. Active clients: ${this.clients.size}`);
        this.onBridgeConnect();

        ws.on('message', (message) => {
          const data = parseBridgeMessage(message.toString());
          if (data) this.handleMessage(data);
          else console.warn('[SpeechServer] Ignored an invalid bridge message.');
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          console.log(`[SpeechServer] Speech bridge client disconnected. Remaining: ${this.clients.size}`);
        });

        ws.on('error', (err) => {
          console.warn('[SpeechServer] WebSocket client error:', err.message);
          this.clients.delete(ws);
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[SpeechServer] Listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  handleHttp(req, res) {
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = (req.url || '').split('?')[0];

    if (!isTrustedRequest(req, this.port)) {
      json(403, { ok: false });
      return;
    }

    if (url === '/api/status') {
      json(200, { version: APP_VERSION, pid: process.pid, recording: this.isRecording });
      return;
    }

    if (url === '/api/takeover' || url === '/api/show') {
      // These change what the running app does, so they need the VoxKey header.
      if (req.headers[CLIENT_HEADER] !== '1') {
        json(403, { ok: false });
        return;
      }
      if (url === '/api/takeover') {
        json(200, { ok: true, quitting: true });
        this.onTakeoverRequest();
      } else {
        this.onShowRequest();
        json(200, { ok: true });
      }
      return;
    }

    if (url === '/' || url === '/stt.html') {
      fs.readFile(PATHS.sttHtml, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Error loading stt.html');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }

  handleMessage(data) {
    if (data.type === 'status') {
      this.clearStartTimer();
      this.isRecording = data.status === 'listening';
      this.onSpeechStatus(data.status);
    } else if (data.type === 'speech_result') {
      this.onSpeechResult(data);
    } else if (data.type === 'speech_error') {
      this.clearStartTimer();
      this.isRecording = false;
      console.warn(`[SpeechServer] Speech bridge error: ${data.error}`);
      this.onSpeechError(data.error);
    } else if (data.type === 'bridge_state') {
      this.bridgeVisible = data.visible;
      if (!data.visible) console.warn('[SpeechServer] The speech bridge page is hidden; Chrome delivers no results while hidden.');
    }
  }

  clearStartTimer() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  hasConnectedClients() {
    return Array.from(this.clients).some(c => c.readyState === 1);
  }

  broadcast(obj) {
    const msg = JSON.stringify(obj);
    let sent = 0;
    for (const client of this.clients) {
      if (client.readyState === 1) {
        try {
          client.send(msg);
          sent++;
        } catch (e) {}
      }
    }
    return sent > 0;
  }

  launchChromeBridge(onBridgeReady = null) {
    if (this.chromeProcess) {
      // Already started; it reconnects by itself. Starting a second copy would only add a process.
      return true;
    }
    const chromePaths = this.chromePaths || chromeCandidates(process.env, os.homedir());

    const chromeExe = chromePaths.find(p => this.fileExists(p));
    if (!chromeExe) {
      console.warn('[SpeechServer] Speech runtime browser not found. Voice typing bridge unavailable.');
      return false;
    }

    // Isolated user-data-dir so browser launches as a separate dedicated process
    // and does NOT collide with or get swallowed by user's already-running browser tabs
    const profileDir = path.join(os.tmpdir(), 'voxkey-speech-profile');

    const args = bridgeArgs(this.port, profileDir);

    console.log('[SpeechServer] Spawning isolated speech bridge...');
    const child = this.spawn(chromeExe, args, { stdio: 'ignore' });
    this.chromeProcess = child;

    const clear = () => {
      if (this.chromeProcess === child) this.chromeProcess = null;
    };
    child.on('exit', (code) => {
      console.log(`[SpeechServer] Speech bridge process exited (${code})`);
      clear();
    });
    child.on('error', (err) => {
      console.warn('[SpeechServer] Could not start the speech bridge:', err.message);
      clear();
    });

    if (onBridgeReady) {
      setTimeout(onBridgeReady, 600);
      setTimeout(onBridgeReady, 1500);
    }

    return true;
  }

  /** Stops the Chrome bridge and starts a new one (for example after it stopped answering). */
  restartBridge() {
    if (this.chromeProcess) {
      try {
        this.chromeProcess.kill();
      } catch (e) {}
      this.chromeProcess = null;
    }
    for (const client of this.clients) {
      try { client.close(); } catch (e) {}
    }
    this.clients.clear();
    return this.launchChromeBridge(this.onBridgeReady);
  }

  toggleVoice(lang = null) {
    if (lang) this.currentLang = lang;

    if (!this.hasConnectedClients()) {
      console.warn('[SpeechServer] No speech bridge connected yet. Triggering Chrome launch...');
      this.launchChromeBridge();
      return false;
    }

    if (this.isRecording || this.startTimer) {
      // Stop, or cancel a start that the bridge has not confirmed yet.
      console.log('[SpeechServer] Stopping voice recording...');
      this.clearStartTimer();
      this.broadcast({ command: 'stop' });
      this.isRecording = false;
      this.onSpeechStatus('idle');
      return false;
    }

    // Ask the bridge to start. "Listening" is shown only when the bridge confirms (handleMessage).
    console.log(`[SpeechServer] Starting voice recording (lang: ${this.currentLang})...`);
    this.broadcast({ command: 'start', lang: this.currentLang });
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      console.warn(`[SpeechServer] The speech bridge did not confirm within ${this.startTimeoutMs} ms.`);
      this.broadcast({ command: 'stop' });
      this.onSpeechError('bridge-no-response');
    }, this.startTimeoutMs);
    return true;
  }

  setLanguage(lang) {
    this.currentLang = lang;
  }

  stop() {
    this.clearStartTimer();
    if (this.chromeProcess) {
      try {
        this.chromeProcess.kill();
      } catch (e) {}
      this.chromeProcess = null;
    }

    for (const client of this.clients) {
      try { client.close(); } catch (e) {}
    }
    this.clients.clear();

    if (this.wss) {
      try {
        this.wss.close();
      } catch (e) {}
      this.wss = null;
    }

    if (this.server) {
      try {
        this.server.close();
      } catch (e) {}
      this.server = null;
    }
  }
}

module.exports = {
  CLIENT_HEADER,
  MAX_TEXT_LENGTH,
  START_TIMEOUT_MS,
  SpeechServer,
  bridgeArgs,
  allowedOrigins,
  chromeCandidates,
  isTrustedRequest,
  parseBridgeMessage,
  voiceErrorText
};
