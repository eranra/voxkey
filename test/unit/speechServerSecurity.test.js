const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { WebSocket } = require('ws');
const {
  SpeechServer,
  CLIENT_HEADER,
  MAX_TEXT_LENGTH,
  chromeCandidates,
  isTrustedRequest,
  parseBridgeMessage
} = require('../../src/speechServer');

const TEST_PORT = 19994;

function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${TEST_PORT}${pathname}`, { headers }, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      })
      .on('error', reject);
  });
}

/** Resolves 'open' or 'refused'. */
function connect(origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, origin ? { origin } : {});
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('error', () => resolve('refused'));
    ws.on('unexpected-response', () => resolve('refused'));
  });
}

describe('SpeechServer security', () => {
  let server;
  let takeovers = 0;
  let shows = 0;
  const results = [];

  before(async () => {
    server = new SpeechServer({
      port: TEST_PORT,
      onTakeoverRequest: () => takeovers++,
      onShowRequest: () => shows++,
      onSpeechResult: (d) => results.push(d)
    });
    await server.start();
  });

  after(() => server.stop());

  it('refuses WebSocket connections from other web pages', async () => {
    assert.strictEqual(await connect('https://evil.example'), 'refused');
    assert.strictEqual(await connect(`http://127.0.0.1:${TEST_PORT + 1}`), 'refused');
  });

  it('accepts the bridge page and local programs', async () => {
    assert.strictEqual(await connect(`http://127.0.0.1:${TEST_PORT}`), 'open');
    assert.strictEqual(await connect(`http://localhost:${TEST_PORT}`), 'open');
    assert.strictEqual(await connect(null), 'open');
  });

  it('takeover and show need the VoxKey header', async () => {
    assert.strictEqual((await get('/api/takeover')).status, 403);
    assert.strictEqual((await get('/api/show')).status, 403);
    assert.strictEqual(takeovers, 0);
    assert.strictEqual(shows, 0);
    assert.strictEqual((await get('/api/show', { [CLIENT_HEADER]: '1' })).status, 200);
    assert.strictEqual(shows, 1);
  });

  it('refuses API calls that a browser makes from another site', async () => {
    const res = await get('/api/takeover', { [CLIENT_HEADER]: '1', 'sec-fetch-site': 'cross-site' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await get('/api/status', { origin: 'https://evil.example' })).status, 403);
    assert.strictEqual(takeovers, 0);
  });

  it('ignores invalid messages from the bridge', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    await new Promise((r) => ws.on('open', r));
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'speech_result', final: { evil: true } }));
    ws.send(JSON.stringify({ type: 'unknown' }));
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    // Only the object-valued message reaches the callback, and with a safe empty string.
    assert.deepStrictEqual(results, [{ type: 'speech_result', interim: '', final: '' }]);
  });
});

describe('isTrustedRequest()', () => {
  const req = (headers) => ({ headers });
  it('trusts requests without browser headers and from our own page', () => {
    assert.strictEqual(isTrustedRequest(req({}), 1), true);
    assert.strictEqual(isTrustedRequest(req({ origin: 'http://127.0.0.1:1', 'sec-fetch-site': 'same-origin' }), 1), true);
    assert.strictEqual(isTrustedRequest(req({ 'sec-fetch-site': 'none' }), 1), true);
  });
  it('does not trust other origins or cross-site requests', () => {
    assert.strictEqual(isTrustedRequest(req({ origin: 'null' }), 1), false);
    assert.strictEqual(isTrustedRequest(req({ 'sec-fetch-site': 'same-site' }), 1), false);
  });
});

describe('parseBridgeMessage()', () => {
  it('keeps valid messages and limits text length', () => {
    assert.deepStrictEqual(parseBridgeMessage('{"type":"status","status":"listening"}'), { type: 'status', status: 'listening' });
    const long = 'a'.repeat(MAX_TEXT_LENGTH + 10);
    assert.strictEqual(parseBridgeMessage(JSON.stringify({ type: 'speech_result', final: long })).final.length, MAX_TEXT_LENGTH);
    assert.deepStrictEqual(parseBridgeMessage('{"type":"speech_error","error":"no-speech"}'), { type: 'speech_error', error: 'no-speech' });
  });
  it('returns null for anything else', () => {
    assert.strictEqual(parseBridgeMessage('[1,2]'), null);
    assert.strictEqual(parseBridgeMessage('null'), null);
    assert.strictEqual(parseBridgeMessage('{"type":"status"}'), null);
  });
});

describe('Chrome bridge launch', () => {
  function fakeChild() {
    const handlers = {};
    return { on: (event, fn) => (handlers[event] = fn), kill: () => {}, emit: (event, ...a) => handlers[event] && handlers[event](...a) };
  }

  it('starts Chrome only once while it runs, and again after it exits', () => {
    const spawned = [];
    const server = new SpeechServer({
      port: 1,
      chromePaths: ['/missing', '/chrome'],
      fileExists: (p) => p === '/chrome',
      spawn: (exe, args) => {
        const child = fakeChild();
        spawned.push({ exe, args, child });
        return child;
      }
    });
    assert.strictEqual(server.launchChromeBridge(), true);
    assert.strictEqual(server.launchChromeBridge(), true);
    assert.strictEqual(spawned.length, 1);
    assert.strictEqual(spawned[0].exe, '/chrome');
    assert.ok(spawned[0].args.includes('--app=http://127.0.0.1:1/stt.html'));
    spawned[0].child.emit('exit', 0);
    server.launchChromeBridge();
    assert.strictEqual(spawned.length, 2);
  });

  it('reports false when Chrome is not installed', () => {
    const server = new SpeechServer({ port: 1, chromePaths: ['/missing'], fileExists: () => false, spawn: () => assert.fail('no spawn') });
    assert.strictEqual(server.launchChromeBridge(), false);
  });

  it('knows the usual Chrome locations on Windows and macOS', () => {
    const list = chromeCandidates({ ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, '/Users/a');
    assert.ok(list.includes('C:\\PF\\Google\\Chrome\\Application\\chrome.exe'));
    assert.ok(list.includes('C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
    assert.ok(list.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
    assert.ok(list.includes('/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  });
});
