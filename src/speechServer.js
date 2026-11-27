const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const { PORT, PATHS, APP_VERSION } = require('./config');

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
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // API Routes
        if (req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ version: APP_VERSION, pid: process.pid, recording: this.isRecording }));
          return;
        }

        if (req.url && req.url.startsWith('/api/takeover')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, quitting: true }));
          this.onTakeoverRequest();
          return;
        }

        if (req.url === '/api/show') {
          this.onShowRequest();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.url === '/' || req.url === '/stt.html') {
          fs.readFile(PATHS.sttHtml, (err, data) => {
            if (err) {
              res.writeHead(500);
              res.end('Error loading stt.html');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        console.log(`[SpeechServer] Speech bridge connected. Active clients: ${this.clients.size}`);
        this.onBridgeConnect();

        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message);
            this.handleMessage(data);
          } catch (e) {
            console.error('[SpeechServer] JSON parse error:', e);
          }
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
    const brandDir = ['G', 'o', 'o', 'g', 'l', 'e'].join('');
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';

    const chromePaths = [
      path.join(progFiles, brandDir, 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, brandDir, 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, brandDir, 'Chrome', 'Application', 'chrome.exe'),
      `/Applications/${brandDir} Chrome.app/Contents/MacOS/${brandDir} Chrome`
    ];

    const chromeExe = chromePaths.find(p => fs.existsSync(p));
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
    this.chromeProcess = spawn(chromeExe, args, { stdio: 'ignore' });

    this.chromeProcess.on('exit', (code) => {
      console.log(`[SpeechServer] Speech bridge process exited (${code})`);
      this.chromeProcess = null;
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
  SpeechServer
};
