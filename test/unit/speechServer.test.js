const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { WebSocket } = require('ws');
const { SpeechServer } = require('../../src/speechServer');
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
      http.get(`http://127.0.0.1:${TEST_PORT}/api/show`, (res) => {
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
      http.get(`http://127.0.0.1:${TEST_PORT}/api/takeover`, (res) => {
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
