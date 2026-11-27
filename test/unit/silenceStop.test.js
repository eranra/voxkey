// Tests for "until-silence" mode: the microphone stops by itself after silence, but only after
// speech was heard, and never in plain toggle mode. Levels and speech results both count as speech.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const { SpeechServer, SILENCE_TIMEOUT_MS, VOICE_LEVEL_THRESHOLD, LOUD_NOISE_TIMEOUT_MS } = require('../../src/speechServer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const servers = [];

/** A server with short silence timing, plus a fake bridge client that records commands. */
function makeServer(options = {}) {
  const sent = [];
  const statuses = [];
  const levels = [];
  const server = new SpeechServer({
    voiceMode: 'until-silence',
    silenceMs: 400,
    silenceCheckMs: 25,
    onSpeechStatus: (s) => statuses.push(s),
    onAudioLevel: (l) => levels.push(l),
    ...options
  });
  server.clients.add({ readyState: 1, send: (msg) => sent.push(JSON.parse(msg)) });
  servers.push(server);
  return { server, sent, statuses, levels };
}

after(() => {
  for (const s of servers) s.stopVoiceTracking();
});

describe('stop after silence', () => {
  it('defaults are a couple of seconds and a low speech threshold', () => {
    assert.ok(SILENCE_TIMEOUT_MS >= 1000 && SILENCE_TIMEOUT_MS <= 4000, String(SILENCE_TIMEOUT_MS));
    assert.ok(VOICE_LEVEL_THRESHOLD > 0 && VOICE_LEVEL_THRESHOLD < 0.5, String(VOICE_LEVEL_THRESHOLD));
    assert.ok(LOUD_NOISE_TIMEOUT_MS >= 5000 && LOUD_NOISE_TIMEOUT_MS <= 30000, String(LOUD_NOISE_TIMEOUT_MS));
  });

  it('stops by itself after speech followed by silence', async () => {
    const { server, sent, statuses } = makeServer();
    server.handleMessage({ type: 'status', status: 'listening' });
    assert.strictEqual(server.isRecording, true);

    server.handleMessage({ type: 'audio_level', level: 0.6 }); // the user speaks
    await sleep(150);
    assert.strictEqual(server.isRecording, true, 'still recording while speaking');

    await sleep(600); // longer than silenceMs, with no further audio
    assert.strictEqual(server.isRecording, false, 'stopped after silence');
    assert.ok(sent.some((m) => m.command === 'stop'), 'the bridge was told to stop');
    assert.deepStrictEqual(statuses, ['listening', 'idle']);
  });

  it('does not stop before any speech was heard', async () => {
    const { server } = makeServer();
    server.handleMessage({ type: 'status', status: 'listening' });
    for (let i = 0; i < 8; i++) {
      server.handleMessage({ type: 'audio_level', level: 0.01 }); // background noise
      await sleep(30);
    }
    assert.strictEqual(server.isRecording, true, 'no speech heard yet, so no auto-stop');
    server.toggleVoice();
    assert.strictEqual(server.isRecording, false, 'a manual press still stops it');
  });

  it('speech results count as speech too (works without level data)', async () => {
    const { server } = makeServer();
    server.handleMessage({ type: 'status', status: 'listening' });
    server.handleMessage({ type: 'speech_result', interim: 'hello', final: '' });
    await sleep(600);
    assert.strictEqual(server.isRecording, false, 'stopped after the text stopped coming');
  });

  it('keeps listening while speech keeps arriving', async () => {
    const { server } = makeServer();
    server.handleMessage({ type: 'status', status: 'listening' });
    for (let i = 0; i < 8; i++) {
      server.handleMessage({ type: 'audio_level', level: 0.5 });
      await sleep(35);
    }
    assert.strictEqual(server.isRecording, true);
    server.toggleVoice();
  });

  it('toggle mode never stops by itself', async () => {
    const { server } = makeServer({ voiceMode: 'toggle' });
    server.handleMessage({ type: 'status', status: 'listening' });
    server.handleMessage({ type: 'audio_level', level: 0.6 });
    await sleep(500);
    assert.strictEqual(server.isRecording, true, 'toggle mode ignores silence');
    server.toggleVoice();
  });

  it('switching to until-silence while recording starts the silence clock', async () => {
    const { server } = makeServer({ voiceMode: 'toggle' });
    server.handleMessage({ type: 'status', status: 'listening' });
    server.setVoiceMode('until-silence');
    server.handleMessage({ type: 'audio_level', level: 0.6 });
    await sleep(600);
    assert.strictEqual(server.isRecording, false, 'now stops after silence');
  });

  it('switching back to toggle while recording stops the silence clock', async () => {
    const { server } = makeServer();
    server.handleMessage({ type: 'status', status: 'listening' });
    server.handleMessage({ type: 'audio_level', level: 0.6 });
    server.setVoiceMode('toggle');
    await sleep(600);
    assert.strictEqual(server.isRecording, true, 'no auto-stop in toggle mode');
    assert.strictEqual(server.silenceTimer, null);
    server.toggleVoice();
  });

  it('a recognizer restart during the silence window does not disarm the auto-stop', async () => {
    const { server } = makeServer();
    server.handleMessage({ type: 'status', status: 'listening' });
    server.handleMessage({ type: 'audio_level', level: 0.6 }); // the user speaks
    // Chrome ends recognition after a pause and the bridge restarts it, which confirms
    // "listening" again. That is not a new recording, so the silence clock must keep running.
    server.handleMessage({ type: 'status', status: 'listening' });
    await sleep(600);
    assert.strictEqual(server.isRecording, false, 'still stops after silence despite the restart');
  });

  it('stops when the microphone stays loud but nothing is recognized (noise)', async () => {
    const { server } = makeServer({ loudNoiseMs: 300 });
    server.handleMessage({ type: 'status', status: 'listening' });
    const start = Date.now();
    while (Date.now() - start < 600 && server.isRecording) {
      server.handleMessage({ type: 'audio_level', level: 0.5 }); // constant loud noise, no text
      await sleep(25);
    }
    assert.strictEqual(server.isRecording, false, 'loud noise with no recognized speech stops the recording');
  });

  it('a quiet pause before speaking is not treated as noise', async () => {
    const { server } = makeServer({ loudNoiseMs: 300 });
    server.handleMessage({ type: 'status', status: 'listening' });
    await sleep(450); // quiet: no levels at all, no speech yet
    assert.strictEqual(server.isRecording, true, 'the noise guard needs loud audio; quiet does not stop it');
    server.toggleVoice();
  });

  it('recognized speech keeps a loud recording alive (the noise guard only fires without text)', async () => {
    const { server } = makeServer({ loudNoiseMs: 300 });
    server.handleMessage({ type: 'status', status: 'listening' });
    const start = Date.now();
    while (Date.now() - start < 450 && server.isRecording) {
      server.handleMessage({ type: 'audio_level', level: 0.5 });
      server.handleMessage({ type: 'speech_result', interim: 'still talking', final: '' });
      await sleep(25);
    }
    assert.strictEqual(server.isRecording, true, 'text keeps arriving, so it keeps listening');
    server.toggleVoice();
  });

  it('an unknown mode is ignored', () => {
    const { server } = makeServer();
    server.setVoiceMode('forever');
    assert.strictEqual(server.voiceMode, 'until-silence');
  });

  it('forwards levels to the keyboard callback while recording', () => {
    const { server, levels } = makeServer();
    server.handleMessage({ type: 'status', status: 'listening' });
    server.handleMessage({ type: 'audio_level', level: 0.6 });
    server.handleMessage({ type: 'audio_level', level: 0.05 });
    assert.deepStrictEqual(levels, [0.6, 0.05]);
  });
});
