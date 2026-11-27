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
  return null;
}

class SpeechServer {
  constructor(options = {}) {
    this.port = options.port || PORT;
    this.server = null;
    this.wss = null;
    this.clients = new Set();
    this.chromeProcess = null;
    this.isRecording = false;
    this.currentLang = 'en-US';

    // Callbacks
    this.onSpeechResult = options.onSpeechResult || (() => {});
    this.onSpeechStatus = options.onSpeechStatus || (() => {});
    this.onSpeechError = options.onSpeechError || (() => {});
    this.onTakeoverRequest = options.onTakeoverRequest || (() => {});
    this.onShowRequest = options.onShowRequest || (() => {});
    this.onBridgeConnect = options.onBridgeConnect || (() => {});

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
      this.isRecording = (data.status === 'listening');
      this.onSpeechStatus(data.status);
    } else if (data.type === 'speech_result') {
      this.onSpeechResult(data);
    } else if (data.type === 'speech_error') {
      this.isRecording = false;
      this.onSpeechError(data.error);
    }
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

    const args = [
      `--app=http://127.0.0.1:${this.port}/stt.html`,
      `--user-data-dir=${profileDir}`,
      '--use-fake-ui-for-media-stream',
      '--window-position=-10000,-10000',
      '--window-size=1,1',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required'
    ];

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

  toggleVoice(lang = null) {
    if (lang) this.currentLang = lang;

    if (!this.hasConnectedClients()) {
      console.warn('[SpeechServer] No speech bridge connected yet. Triggering Chrome launch...');
      this.launchChromeBridge();
      return false;
    }

    if (this.isRecording) {
      console.log('[SpeechServer] Stopping voice recording...');
      this.broadcast({ command: 'stop' });
      this.isRecording = false;
      this.onSpeechStatus('idle');
      return false;
    } else {
      console.log(`[SpeechServer] Starting voice recording (lang: ${this.currentLang})...`);
      this.broadcast({ command: 'start', lang: this.currentLang });
      this.isRecording = true;
      this.onSpeechStatus('listening');
      return true;
    }
  }

  setLanguage(lang) {
    this.currentLang = lang;
  }

  stop() {
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
  SpeechServer,
  allowedOrigins,
  chromeCandidates,
  isTrustedRequest,
  parseBridgeMessage
};
