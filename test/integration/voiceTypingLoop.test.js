const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { WebSocket } = require('ws');
const { SpeechServer } = require('../../src/speechServer');

describe('Voice Typing End-to-End Loop Integration Test', () => {
  const TEST_PORT = 19993;
  let server = null;
  let receivedResults = [];
  let statuses = [];
  let receivedLevels = [];

  before(async () => {
    server = new SpeechServer({
      port: TEST_PORT,
      // Short silence timing, so the until-silence test below runs fast.
      silenceMs: 250,
      silenceCheckMs: 25,
      onSpeechResult: (data) => {
        receivedResults.push(data);
      },
      onSpeechStatus: (status) => {
        statuses.push(status);
      },
      onAudioLevel: (level) => {
        receivedLevels.push(level);
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

  it('should stop by itself after silence, in until-silence mode', async () => {
    server.setVoiceMode('until-silence');
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    const clientMessages = [];

    await new Promise((resolve) => ws.on('open', resolve));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientMessages.push(msg);
      if (msg.command === 'start') ws.send(JSON.stringify({ type: 'status', status: 'listening' }));
    });

    // 1. User presses F8; the bridge confirms, and the silence clock starts.
    const isStarted = server.toggleVoice('en-US');
    assert.strictEqual(isStarted, true);
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(server.isRecording, true);

    // 2. The user speaks: loud levels arrive from the bridge (like stt.html sends them).
    receivedLevels.length = 0;
    for (let i = 0; i < 4; i++) {
      ws.send(JSON.stringify({ type: 'audio_level', level: 0.6 }));
      await new Promise(r => setTimeout(r, 30));
    }
    assert.strictEqual(server.isRecording, true, 'speech keeps it listening');
    assert.ok(receivedLevels.length >= 4, 'levels reach the main process');

    // 3. Silence: only quiet levels arrive.
    for (let i = 0; i < 8; i++) {
      ws.send(JSON.stringify({ type: 'audio_level', level: 0.01 }));
      await new Promise(r => setTimeout(r, 60));
    }

    // 4. VoxKey stopped by itself and told the bridge to stop.
    assert.strictEqual(server.isRecording, false, 'stopped after silence');
    assert.ok(clientMessages.some((m) => m.command === 'stop'), 'the bridge was told to stop');
    assert.strictEqual(statuses.at(-1), 'idle');

    server.setVoiceMode('toggle');
    ws.close();
    await new Promise(r => setTimeout(r, 50));
  });
});
