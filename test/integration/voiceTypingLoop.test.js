const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const { SpeechServer } = require('../../src/speechServer');

describe('Voice Typing End-to-End Loop Integration Test', () => {
  const TEST_PORT = 19993;
  let server = null;
  let receivedResults = [];
  let statuses = [];

  before(async () => {
    server = new SpeechServer({
      port: TEST_PORT,
      onSpeechResult: (data) => {
        receivedResults.push(data);
      },
      onSpeechStatus: (status) => {
        statuses.push(status);
      }
    });

    await server.start();
  });

  after(() => {
    if (server) server.stop();
  });

  it('should toggle voice to start, send speech, and toggle to stop', async () => {
    // 1. Mock bridge connects via WebSocket
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    const clientMessages = [];

    await new Promise((resolve) => ws.on('open', resolve));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientMessages.push(msg);
      // Like stt.html: confirm a start once recognition runs.
      if (msg.command === 'start') ws.send(JSON.stringify({ type: 'status', status: 'listening' }));
    });

    // 2. User presses F8 (toggleVoice). VoxKey asks the bridge to start, and waits for its confirmation.
    const isStarted = server.toggleVoice('en-US');
    assert.strictEqual(isStarted, true);
    assert.strictEqual(server.isRecording, false, 'not "listening" before the bridge confirms');

    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(server.isRecording, true);
    assert.deepStrictEqual(statuses, ['listening']);

    // Verify Chrome bridge received start command
    assert.ok(clientMessages.length > 0);
    assert.strictEqual(clientMessages[0].command, 'start');
    assert.strictEqual(clientMessages[0].lang, 'en-US');

    // 3. Chrome bridge sends recognized text
    ws.send(JSON.stringify({
      type: 'speech_result',
      interim: 'testing',
      final: 'testing voice typing'
    }));

    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(receivedResults.length, 1);
    assert.strictEqual(receivedResults[0].final, 'testing voice typing');

    // 4. User presses F8 again to stop
    const isStopped = server.toggleVoice();
    assert.strictEqual(isStopped, false);
    assert.strictEqual(server.isRecording, false);

    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(clientMessages.length, 2);
    assert.strictEqual(clientMessages[1].command, 'stop');

    ws.close();
  });
});
