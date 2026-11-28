// Tests for the voice-typing chain: the Chrome bridge page (stt.html), how Chrome is started,
// and the start/confirm handshake between VoxKey and the page.
//
// Background (bug found 2026-11-27): Chrome delivers no speech results while the page is hidden.
// On macOS, Chrome counts a window as hidden when other windows cover it. The tiny bridge window was
// often covered, so dictation showed "Listening" but never typed anything.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { WebSocket } = require('ws');
const { SpeechServer, bridgeArgs, removeStaleBridgeProfiles, START_TIMEOUT_MS, voiceErrorText } = require('../../src/speechServer');

// ---- A sandbox that runs the real stt.html script -------------------------------------------------

const sttScript = (() => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'stt.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.strictEqual(scripts.length, 1, 'stt.html has one inline script');
  return scripts[0];
})();

function loadBridgePage({ hidden = false, audioLevel = null, gumRejects = false } = {}) {
  const sent = [];
  const recognitions = [];
  const docListeners = {};
  // State of the microphone measurement (only used when audioLevel is given).
  const micState = { timers: [], tracksStopped: 0, contextsClosed: 0 };

  class FakeRecognition {
    constructor() {
      this.running = false;
      this.starts = 0;
      recognitions.push(this);
    }
    start() {
      if (this.running) throw new Error('InvalidStateError: already started');
      this.running = true;
      this.starts++;
      if (this.onstart) this.onstart();
    }
    stop() {
      this.running = false;
      if (this.onend) this.onend();
    }
    // Test helpers: what Chrome does.
    fireError(error) {
      if (this.onerror) this.onerror({ error });
      this.running = false;
      if (this.onend) this.onend();
    }
  }

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      page.socket = this;
    }
    send(text) {
      sent.push(JSON.parse(text));
    }
  }
  FakeSocket.OPEN = 1;

  const document = {
    hidden,
    visibilityState: hidden ? 'hidden' : 'visible',
    getElementById: () => ({ style: {} }),
    addEventListener: (type, fn) => (docListeners[type] = fn)
  };

  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    setTimeout: () => 0,
    setInterval: (fn) => {
      micState.timers.push(fn);
      return micState.timers.length;
    },
    clearInterval: () => {
      micState.timers.length = 0;
    },
    document,
    location: { host: '127.0.0.1:19876' },
    WebSocket: FakeSocket,
    webkitSpeechRecognition: FakeRecognition
  };

  if (audioLevel !== null || gumRejects) {
    // The browser side of the level measurement: a microphone stream and an analyser
    // whose samples all read `audioLevel` (128 = silence, 148 = a loud constant tone).
    sandbox.navigator = {
      mediaDevices: {
        getUserMedia: () =>
          gumRejects
            ? Promise.reject(new Error('NotAllowedError'))
            : Promise.resolve({
                getTracks: () => [{ stop: () => micState.tracksStopped++ }]
              })
      }
    };
    class FakeAudioContext {
      resume() {
        return Promise.resolve();
      }
      close() {
        micState.contextsClosed++;
        return Promise.resolve();
      }
      createAnalyser() {
        return {
          fftSize: 0,
          getByteTimeDomainData(buf) {
            for (let i = 0; i < buf.length; i++) buf[i] = audioLevel;
          }
        };
      }
      createMediaStreamSource() {
        return { connect() {} };
      }
    }
    sandbox.AudioContext = FakeAudioContext;
  }

  sandbox.window = sandbox;
  sandbox.window.moveTo = () => {};
  sandbox.window.resizeTo = () => {};

  const page = {
    sent,
    recognitions,
    socket: null,
    micState,
    /** Opens the WebSocket, as the browser would. */
    connect() {
      sandbox.window.onload();
      page.socket.readyState = 1;
      page.socket.onopen();
    },
    /** A message from VoxKey to the page. */
    receive(msg) {
      page.socket.onmessage({ data: JSON.stringify(msg) });
    },
    setHidden(value) {
      document.hidden = value;
      document.visibilityState = value ? 'hidden' : 'visible';
      if (docListeners.visibilitychange) docListeners.visibilitychange();
    },
    /** Runs the level timer once, as the browser would every 100 ms. */
    tickLevel() {
      for (const fn of micState.timers) fn();
    },
    get recognition() {
      return recognitions[recognitions.length - 1];
    }
  };

  vm.runInNewContext(sttScript, sandbox);
  return page;
}

// ---- How Chrome is started ----------------------------------------------------------------------

describe('Chrome bridge start options', () => {
  const args = bridgeArgs(19876, '/tmp/profile');

  it('keeps the page "visible" when other windows cover it, so speech results arrive', () => {
    for (const option of ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']) {
      assert.ok(args.includes(option), option);
    }
    assert.ok(args.some((a) => a.startsWith('--disable-features=') && a.includes('CalculateNativeWinOcclusion')), 'Windows occlusion off');
  });

  it('opens our page in its own profile and allows the microphone without a prompt', () => {
    assert.ok(args.includes('--app=http://127.0.0.1:19876/stt.html'));
    assert.ok(args.includes('--user-data-dir=/tmp/profile'));
    assert.ok(args.includes('--use-fake-ui-for-media-stream'));
  });

  it('the launched Chrome gets exactly these options', () => {
    let spawnedArgs = null;
    const server = new SpeechServer({
      port: 19876,
      chromePaths: ['/chrome'],
      fileExists: () => true,
      spawn: (exe, a) => {
        spawnedArgs = a;
        return { on() {}, kill() {} };
      }
    });
    server.launchChromeBridge();
    for (const option of ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']) {
      assert.ok(spawnedArgs.includes(option), option);
    }
  });
});

// ---- The bridge page (stt.html) -------------------------------------------------------------------

describe('bridge page', () => {
  it('starts recognition on "start" and confirms with status "listening"', () => {
    const page = loadBridgePage();
    page.connect();
    page.receive({ command: 'start', lang: 'he-IL' });
    assert.strictEqual(page.recognition.running, true);
    assert.strictEqual(page.recognition.lang, 'he-IL');
    assert.deepStrictEqual(page.sent.at(-1), { type: 'status', status: 'listening' });
  });

  it('refuses to start while the page is hidden, and says why', () => {
    const page = loadBridgePage({ hidden: true });
    page.connect();
    page.receive({ command: 'start', lang: 'en-US' });
    assert.strictEqual(page.recognition.running, false, 'a hidden page gets no results, so it must not pretend to listen');
    assert.deepStrictEqual(page.sent.at(-1), { type: 'speech_error', error: 'page-hidden' });
  });

  it('reports when it becomes hidden or visible', () => {
    const page = loadBridgePage();
    page.connect();
    page.setHidden(true);
    assert.deepStrictEqual(page.sent.at(-1), { type: 'bridge_state', visible: false });
    page.setHidden(false);
    assert.deepStrictEqual(page.sent.at(-1), { type: 'bridge_state', visible: true });
  });

  it('a "no-speech" pause is not an error: the page keeps listening', () => {
    const page = loadBridgePage();
    page.connect();
    page.receive({ command: 'start' });
    const before = page.sent.length;
    page.recognition.fireError('no-speech');
    assert.strictEqual(page.recognition.running, true, 'restarted by itself');
    assert.ok(!page.sent.slice(before).some((m) => m.type === 'speech_error'), 'no error reported');
  });

  it('a real error is reported, and the page stops', () => {
    const page = loadBridgePage();
    page.connect();
    page.receive({ command: 'start' });
    page.recognition.fireError('not-allowed');
    assert.ok(page.sent.some((m) => m.type === 'speech_error' && m.error === 'not-allowed'));
    assert.strictEqual(page.recognition.running, false);
    assert.deepStrictEqual(page.sent.at(-1), { type: 'status', status: 'idle' });
  });

  it('a reconnect does not leave a second recognizer running', () => {
    const page = loadBridgePage();
    page.connect();
    page.receive({ command: 'start' });
    const first = page.recognition;
    page.connect(); // the WebSocket reconnected (for example VoxKey restarted)
    assert.strictEqual(page.recognitions.filter((r) => r.running).length <= 1, true);
    assert.strictEqual(page.recognition, first, 'the same recognizer is reused');
  });

  it('sends interim and final text', () => {
    const page = loadBridgePage();
    page.connect();
    page.receive({ command: 'start' });
    const result = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });
    page.recognition.onresult({ resultIndex: 0, results: [result('hello world', true), result('and mo', false)] });
    assert.deepStrictEqual(page.sent.at(-1), { type: 'speech_result', interim: 'and mo', final: 'hello world' });
  });

  it('sends microphone levels while listening, and releases the microphone on stop', async () => {
    const page = loadBridgePage({ audioLevel: 148 }); // a loud constant tone
    page.connect();
    page.receive({ command: 'start' });
    await new Promise((r) => setTimeout(r, 0)); // getUserMedia resolves
    page.tickLevel();
    // Every sample reads 148, so the level is the RMS of (148-128)/128 = 0.15625, scaled by 3.
    assert.deepStrictEqual(page.sent.filter((m) => m.type === 'audio_level').at(-1), { type: 'audio_level', level: 0.46875 });
    assert.strictEqual(page.micState.tracksStopped, 0, 'the microphone stays open while listening');

    page.receive({ command: 'stop' });
    assert.strictEqual(page.micState.timers.length, 0, 'the level timer stops');
    assert.strictEqual(page.micState.tracksStopped, 1, 'the microphone stream is released');
    assert.strictEqual(page.micState.contextsClosed, 1, 'the audio context is closed');
    page.tickLevel(); // must not crash or send anything
    assert.ok(!page.sent.slice(-1).some((m) => m.type === 'audio_level'));
  });

  it('a quiet microphone reports a level of zero', async () => {
    const page = loadBridgePage({ audioLevel: 128 }); // perfect silence
    page.connect();
    page.receive({ command: 'start' });
    await new Promise((r) => setTimeout(r, 0));
    page.tickLevel();
    assert.deepStrictEqual(page.sent.filter((m) => m.type === 'audio_level').at(-1), { type: 'audio_level', level: 0 });
  });

  it('says so when the microphone cannot be measured, so VoxKey does not wait for levels', async () => {
    const page = loadBridgePage(); // no navigator.mediaDevices: measurement unavailable
    page.connect();
    page.receive({ command: 'start' });
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(page.recognition.running, true);
    assert.deepStrictEqual(page.sent.at(-1), { type: 'status', status: 'listening' });
    assert.ok(!page.sent.some((m) => m.type === 'audio_level'), 'no levels, but no failure either');
    assert.ok(page.sent.some((m) => m.type === 'levels_error'), 'the page reports that levels are unavailable');
  });

  it('also reports a rejected microphone request, instead of failing silently', async () => {
    const page = loadBridgePage({ gumRejects: true });
    page.connect();
    page.receive({ command: 'start' });
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(page.recognition.running, true, 'dictation still runs');
    assert.ok(page.sent.some((m) => m.type === 'levels_error'));
  });

  it('restarts the session in the new language when the language changes mid-session', () => {
    const page = loadBridgePage();
    page.connect();
    page.receive({ command: 'start', lang: 'en-US' });
    assert.strictEqual(page.recognition.starts, 1);

    // Chrome applies recognition.lang only when a session starts, so a language change
    // while listening must end the running session; onend then restarts it.
    page.receive({ command: 'start', lang: 'he-IL' });
    assert.strictEqual(page.recognition.lang, 'he-IL', 'the recognizer carries the new language');
    assert.strictEqual(page.recognition.starts, 2, 'a new session started in the new language');
    assert.strictEqual(page.recognition.running, true, 'still listening after the switch');
    assert.strictEqual(page.recognitions.length, 1, 'the same recognizer, not a new one');
    assert.deepStrictEqual(page.sent.at(-1), { type: 'status', status: 'listening' });
    assert.ok(!page.sent.some((m) => m.type === 'status' && m.status === 'idle'), 'no idle flicker during the switch');
  });

  it('a language change while the page is hidden stops the session instead of leaving a ghost running', () => {
    const page = loadBridgePage();
    page.connect();
    page.receive({ command: 'start', lang: 'en-US' });
    assert.strictEqual(page.recognition.running, true);

    // The page becomes hidden, then VoxKey re-broadcasts the start in a new language.
    // The old session would keep running in the old language while VoxKey reports an error,
    // so the page must end it, report the error, and not auto-restart.
    page.setHidden(true);
    page.receive({ command: 'start', lang: 'he-IL' });
    assert.strictEqual(page.recognition.running, false, 'the session ends');
    assert.strictEqual(page.recognition.starts, 1, 'no restart while hidden');
    assert.deepStrictEqual(page.sent.at(-1), { type: 'speech_error', error: 'page-hidden' });
    assert.ok(page.sent.some((m) => m.type === 'status' && m.status === 'idle'), 'the ended session is reported idle');

    // Once visible again, dictation starts cleanly in the new language.
    page.setHidden(false);
    page.receive({ command: 'start', lang: 'he-IL' });
    assert.strictEqual(page.recognition.running, true);
    assert.strictEqual(page.recognition.lang, 'he-IL');
    assert.strictEqual(page.recognition.starts, 2, 'a fresh session in the new language');
    assert.deepStrictEqual(page.sent.at(-1), { type: 'status', status: 'listening' });
  });

  it('a start with the same language while running does not restart the session', () => {
    const page = loadBridgePage();
    page.connect();
    page.receive({ command: 'start', lang: 'en-US' });
    const starts = page.recognition.starts;
    page.receive({ command: 'start', lang: 'en-US' });
    assert.strictEqual(page.recognition.starts, starts, 'no restart');
    assert.strictEqual(page.recognition.running, true);
    assert.deepStrictEqual(page.sent.at(-1), { type: 'status', status: 'listening' });
  });
});

// ---- The start/confirm handshake in VoxKey --------------------------------------------------------

describe('voice start handshake', () => {
  const PORT = 19995;
  let server;
  const statuses = [];
  const errors = [];

  before(async () => {
    server = new SpeechServer({
      port: PORT,
      startTimeoutMs: 150,
      onSpeechStatus: (s) => statuses.push(s),
      onSpeechError: (e) => errors.push(e)
    });
    await server.start();
  });

  after(() => server.stop());

  async function connectBridge(onMessage) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise((r) => ws.on('open', r));
    ws.on('message', (raw) => onMessage(JSON.parse(raw.toString()), ws));
    return ws;
  }

  it('does not show "listening" until the bridge confirms', async () => {
    statuses.length = 0;
    let startSeen = null;
    const ws = await connectBridge((msg, sock) => {
      if (msg.command === 'start') {
        startSeen = msg;
        setTimeout(() => sock.send(JSON.stringify({ type: 'status', status: 'listening' })), 40);
      }
    });
    server.toggleVoice('en-US');
    assert.strictEqual(server.isRecording, false, 'not yet confirmed');
    assert.ok(!statuses.includes('listening'));
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(startSeen.command, 'start');
    assert.strictEqual(server.isRecording, true);
    assert.deepStrictEqual(statuses, ['listening']);
    server.toggleVoice();
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('reports an error when the bridge never confirms, instead of hanging in "Listening"', async () => {
    errors.length = 0;
    statuses.length = 0;
    const ws = await connectBridge(() => {}); // a bridge that ignores "start"
    server.toggleVoice('en-US');
    await new Promise((r) => setTimeout(r, 250));
    assert.deepStrictEqual(errors, ['bridge-no-response']);
    assert.strictEqual(server.isRecording, false);
    assert.ok(!statuses.includes('listening'));
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('pressing the mic again while starting cancels the start', async () => {
    errors.length = 0;
    const commands = [];
    const ws = await connectBridge((msg) => commands.push(msg.command));
    server.toggleVoice('en-US');
    server.toggleVoice();
    await new Promise((r) => setTimeout(r, 250));
    assert.deepStrictEqual(commands, ['start', 'stop']);
    assert.deepStrictEqual(errors, [], 'a cancelled start is not an error');
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('the default confirmation time is a few seconds', () => {
    assert.ok(START_TIMEOUT_MS >= 2000 && START_TIMEOUT_MS <= 8000);
  });
});

// ---- A microphone that never delivers audio --------------------------------------------------------
//
// Background (bug found 2026-11-28): when macOS audio gets into a stuck state (observed after
// Chrome instances are killed while an audio stream is opening), the bridge confirms "listening"
// but its microphone never delivers samples and the recognizer produces nothing. VoxKey showed
// "Listening (speak now)" forever. The server now notices that no levels, no results and no
// levels-unavailable notice arrived, and reports it as an error instead.

describe('microphone stuck detection', () => {
  const PORT = 19996;
  let server;
  const errors = [];
  const statuses = [];

  before(async () => {
    server = new SpeechServer({
      port: PORT,
      startTimeoutMs: 150,
      micStuckMs: 120,
      onSpeechStatus: (s) => statuses.push(s),
      onSpeechError: (e) => errors.push(e)
    });
    await server.start();
  });

  after(() => server.stop());

  async function connectBridge(onMessage) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise((r) => ws.on('open', r));
    ws.on('message', (raw) => onMessage(JSON.parse(raw.toString()), ws));
    return ws;
  }

  /** Starts dictation with a bridge that confirms "listening" and then goes quiet. */
  async function startSilentBridge(extra) {
    errors.length = 0;
    const ws = await connectBridge((msg, sock) => {
      if (msg.command === 'start') {
        sock.send(JSON.stringify({ type: 'status', status: 'listening' }));
        if (extra) extra(sock);
      }
    });
    server.toggleVoice('en-US');
    await new Promise((r) => setTimeout(r, 60)); // past the start handshake
    return ws;
  }

  it('reports mic-stuck when the bridge listens but nothing arrives', async () => {
    const ws = await startSilentBridge();
    await new Promise((r) => setTimeout(r, 250));
    assert.deepStrictEqual(errors, ['mic-stuck']);
    assert.strictEqual(server.isRecording, false, 'not listening anymore');
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('keeps waiting while audio levels arrive', async () => {
    const ws = await startSilentBridge((sock) => {
      const timer = setInterval(() => sock.send(JSON.stringify({ type: 'audio_level', level: 0.01 })), 40);
      setTimeout(() => clearInterval(timer), 400);
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual(errors, [], 'levels prove the microphone works');
    server.toggleVoice(); // stop, and clear the detection state
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('keeps waiting when the bridge says levels are unavailable', async () => {
    const ws = await startSilentBridge((sock) => {
      sock.send(JSON.stringify({ type: 'levels_error' }));
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual(errors, []);
    server.toggleVoice();
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('a speech result also proves that audio arrives', async () => {
    const ws = await startSilentBridge((sock) => {
      setTimeout(() => sock.send(JSON.stringify({ type: 'speech_result', interim: 'hello', final: '' })), 60);
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual(errors, []);
    server.toggleVoice();
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});

// ---- Telling the user, and recovering ------------------------------------------------------------

describe('voice errors', () => {
  it('every error the bridge or VoxKey reports has a clear message', () => {
    assert.match(voiceErrorText('page-hidden'), /hidden/);
    assert.match(voiceErrorText('bridge-no-response'), /did not respond/);
    assert.match(voiceErrorText('mic-stuck'), /microphone/i);
    assert.match(voiceErrorText('mic-permission'), /microphone/i);
    assert.match(voiceErrorText('not-allowed'), /microphone/i);
    assert.match(voiceErrorText('network'), /internet/);
    assert.match(voiceErrorText('audio-capture'), /microphone/i);
    assert.strictEqual(voiceErrorText('something-new'), 'Voice typing stopped: something-new');
  });

  it('restartBridge() replaces the Chrome bridge', () => {
    const spawned = [];
    const killed = [];
    const server = new SpeechServer({
      port: 1,
      chromePaths: ['/chrome'],
      fileExists: () => true,
      spawn: () => {
        const child = { on() {}, kill: () => killed.push(child) };
        spawned.push(child);
        return child;
      }
    });
    server.launchChromeBridge();
    server.restartBridge();
    assert.strictEqual(spawned.length, 2);
    assert.deepStrictEqual(killed, [spawned[0]]);
  });

  it('every bridge launch gets a fresh profile directory', () => {
    // A long-lived profile once got into a state where the speech recognizer ended every session
    // instantly, without any error, while the microphone itself kept working (macOS, 2026-11-28).
    // A fresh profile per launch contains that.
    const spawnedArgs = [];
    const server = new SpeechServer({
      port: 1,
      chromePaths: ['/chrome'],
      fileExists: () => true,
      spawn: (exe, args) => {
        spawnedArgs.push(args);
        return { on() {}, kill() {} };
      }
    });
    server.launchChromeBridge();
    server.restartBridge();
    const dirs = spawnedArgs.map((args) => args.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length));
    assert.strictEqual(dirs.length, 2);
    assert.notStrictEqual(dirs[0], dirs[1], 'each launch creates its own profile directory');
    for (const dir of dirs) {
      assert.ok(path.basename(dir).startsWith('voxkey-speech-'), `${dir} is a VoxKey bridge directory`);
      assert.ok(fs.existsSync(dir), 'the directory exists');
    }
  });

  it('stale bridge profiles are cleaned up, fresh ones are kept', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voxkey-clean-test-'));
    try {
      const day = 24 * 60 * 60 * 1000;
      const stale = path.join(tmp, 'voxkey-speech-stale');
      const legacy = path.join(tmp, 'voxkey-speech-profile');
      const fresh = path.join(tmp, 'voxkey-speech-fresh');
      const keep = path.join(tmp, 'voxkey-speech-keep');
      for (const dir of [stale, legacy, fresh, keep]) fs.mkdirSync(dir);
      const old = new Date(Date.now() - 2 * day);
      fs.utimesSync(stale, old, old);
      fs.utimesSync(legacy, old, old);
      removeStaleBridgeProfiles(keep, tmp);
      assert.ok(!fs.existsSync(stale), 'old bridge profiles are removed');
      assert.ok(!fs.existsSync(legacy), 'the legacy fixed directory is removed too');
      assert.ok(fs.existsSync(fresh), 'a recent bridge directory is kept');
      assert.ok(fs.existsSync(keep), 'the directory of the current bridge is kept');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the keyboard page shows voice errors', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'app.js'), 'utf8');
    assert.match(app, /api\.onVoiceError\(/);
  });
});
