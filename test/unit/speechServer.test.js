const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { WebSocket } = require('ws');
const { SpeechServer, CLIENT_HEADER } = require('../../src/speechServer');
const { APP_VERSION } = require('../../src/config');

describe('SpeechServer Unit & Integration Tests', () => {
  const TEST_PORT = 19991;
  let server = null;
  let showCalled = false;
  let takeoverCalled = false;
  let speechResults = [];
  let speechStatuses = [];

  before(async () => {
    server = new SpeechServer({
      port: TEST_PORT,
      onShowRequest: () => { showCalled = true; },
      onTakeoverRequest: () => { takeoverCalled = true; },
      onSpeechResult: (data) => { speechResults.push(data); },
      onSpeechStatus: (status) => { speechStatuses.push(status); }
    });

    await server.start();
  });

  after(() => {
    if (server) server.stop();
  });

  it('GET /api/status should return JSON with version and PID', async () => {
    const data = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/api/status`, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => resolve(JSON.parse(raw)));
      }).on('error', reject);
    });

    assert.strictEqual(data.version, APP_VERSION);
    assert.strictEqual(typeof data.pid, 'number');
  });

  it('GET /api/show should trigger show callback', async () => {
    showCalled = false;
    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/api/show`, { headers: { [CLIENT_HEADER]: '1' } }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => resolve(JSON.parse(raw)));
      }).on('error', reject);
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(showCalled, true);
  });

  it('GET /api/takeover should trigger takeover callback', async () => {
    takeoverCalled = false;
    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/api/takeover`, { headers: { [CLIENT_HEADER]: '1' } }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => resolve(JSON.parse(raw)));
      }).on('error', reject);
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(takeoverCalled, true);
  });

  it('GET /stt.html should serve the HTML bridge page', async () => {
    const html = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/stt.html`, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => resolve(raw));
      }).on('error', reject);
    });

    assert.ok(html.includes('VoxKey Speech Bridge'));
  });

  it('WebSocket should connect, receive speech data and handle toggleVoice', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);

    await new Promise((resolve) => ws.on('open', resolve));

    // Client sends speech status
    ws.send(JSON.stringify({ type: 'status', status: 'listening' }));

    // Client sends speech recognition result
    ws.send(JSON.stringify({
      type: 'speech_result',
      interim: 'hello',
      final: 'hello world'
    }));

    await new Promise(r => setTimeout(r, 100));

    assert.ok(speechStatuses.includes('listening'));
    assert.strictEqual(speechResults.length, 1);
    assert.strictEqual(speechResults[0].final, 'hello world');

    // Test server sending start/stop command to client
    const clientReceived = [];
    ws.on('message', (msg) => {
      clientReceived.push(JSON.parse(msg.toString()));
    });

    server.toggleVoice('es-ES');
    await new Promise(r => setTimeout(r, 100));

    assert.ok(clientReceived.length > 0);
    assert.strictEqual(clientReceived[0].command, 'stop'); // Was listening, so toggle stops it

    ws.close();
  });
});

describe('setLanguage switches the recognition language', () => {
  const TEST_PORT = 19997;
  let server;
  const errors = [];

  before(async () => {
    server = new SpeechServer({
      port: TEST_PORT,
      startTimeoutMs: 150,
      onSpeechError: (e) => errors.push(e)
    });
    await server.start();
  });

  after(() => server.stop());

  async function connectBridge(onMessage) {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    await new Promise((r) => ws.on('open', r));
    ws.on('message', (raw) => onMessage(JSON.parse(raw.toString()), ws));
    return ws;
  }

  it('while dictating, broadcasts a new start with the new language', async () => {
    const commands = [];
    const ws = await connectBridge((msg, sock) => {
      commands.push(msg);
      if (msg.command === 'start') sock.send(JSON.stringify({ type: 'status', status: 'listening' }));
    });

    server.toggleVoice('en-US');
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(server.isRecording, true, 'dictation confirmed');
    commands.length = 0;

    server.setLanguage('he-IL');
    await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(commands, [{ command: 'start', lang: 'he-IL' }]);
    assert.strictEqual(server.isRecording, true, 'still dictating after the switch');

    server.toggleVoice(); // stop, so the next test starts idle
    ws.close();
    await new Promise((r) => setTimeout(r, 30));
  });

  it('while idle, stores the language and sends nothing', async () => {
    const commands = [];
    const ws = await connectBridge((msg) => commands.push(msg));
    await new Promise((r) => setTimeout(r, 30));

    server.setLanguage('fr-FR');
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(commands, [], 'no message while idle');

    // The next dictation picks up the stored language.
    server.toggleVoice();
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(commands, [{ command: 'start', lang: 'fr-FR' }]);

    server.toggleVoice();
    ws.close();
    await new Promise((r) => setTimeout(r, 30));
  });

  it('while a start is still unconfirmed, re-broadcasts without stacking a second start timer', async () => {
    errors.length = 0;
    const commands = [];
    const ws = await connectBridge((msg) => commands.push(msg)); // ignores every start

    server.toggleVoice('en-US');
    assert.ok(server.startTimer, 'a start is pending');
    server.setLanguage('de-DE');
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(commands, [
      { command: 'start', lang: 'en-US' },
      { command: 'start', lang: 'de-DE' }
    ]);
    assert.ok(server.startTimer, 'the same single start timer is still pending');

    // The one pending timer still fires once when the bridge never confirms.
    await new Promise((r) => setTimeout(r, 200));
    assert.deepStrictEqual(errors, ['bridge-no-response']);

    ws.close();
    await new Promise((r) => setTimeout(r, 30));
  });
});
