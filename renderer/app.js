// `window.voxkey` comes from preload.js. This page has no Node.js access.
// `window.VoxKeyLanguages` comes from languages.js, loaded before this file.
const api = window.voxkey;
const { LANGUAGES, DEFAULT_LANGUAGE } = window.VoxKeyLanguages;

let currentLangKey = DEFAULT_LANGUAGE;
let currentLayout = 'lower';
let isShift = false;
let isRecording = false;
let isCollapsed = false;

// DOM Elements
const micBtn = document.getElementById('mic-btn');
const transcriptBox = document.getElementById('transcript-box');
const transcriptPlaceholder = document.getElementById('transcript-placeholder');
const transcriptInterim = document.getElementById('transcript-interim');
const langSelect = document.getElementById('lang-select');
const minimizeBtn = document.getElementById('minimize-btn');
const compactIcon = document.getElementById('compact-icon');
const hideBtn = document.getElementById('hide-btn');
const closeBtn = document.getElementById('close-btn');
const keyboardBody = document.getElementById('keyboard-body');
const appContainer = document.querySelector('.voxkey-container');

// Render Keyboard Rows
function renderKeyboard() {
  const layouts = LANGUAGES[currentLangKey].layouts;
  // Caseless scripts (Hebrew, Arabic) have no uppercase variant.
  const rows = layouts[currentLayout] || layouts.lower;
  for (let i = 0; i < 4; i++) {
    const rowEl = document.getElementById(`row-${i + 1}`);
    rowEl.innerHTML = '';

    rows[i].forEach(keyData => {
      const keyEl = document.createElement('div');
      keyEl.className = 'key';

      if (typeof keyData === 'string') {
        keyEl.textContent = keyData;
        keyEl.onclick = () => onKeyClick(keyData);
      } else {
        keyEl.textContent = keyData.label;
        keyEl.classList.add('key-action');

        if (keyData.action === 'shift') {
          keyEl.classList.add('key-shift');
          if (isShift) keyEl.classList.add('active');
          keyEl.onclick = toggleShift;
        } else if (keyData.action === 'backspace') {
          keyEl.classList.add('key-backspace');
          keyEl.onclick = () => onActionClick('BACKSPACE');
        } else if (keyData.action === 'space') {
          keyEl.classList.add('key-space');
          keyEl.textContent = LANGUAGES[currentLangKey].name;
          keyEl.onclick = () => onActionClick('SPACE');
        } else if (keyData.action === 'enter') {
          keyEl.classList.add('key-enter');
          keyEl.onclick = () => onActionClick('ENTER');
        } else if (keyData.action === 'symbols') {
          keyEl.onclick = () => switchLayout('symbols');
        } else if (keyData.action === 'alt_symbols') {
          keyEl.onclick = () => switchLayout('alt_symbols');
        } else if (keyData.action === 'abc') {
          keyEl.onclick = () => switchLayout('lower');
        }
      }

      rowEl.appendChild(keyEl);
    });
  }
}

function onKeyClick(char) {
  console.log('[Renderer] Key clicked:', char);
  api.injectText(char);
  if (isShift && currentLayout === 'upper') {
    isShift = false;
    currentLayout = 'lower';
    renderKeyboard();
  }
}

function onActionClick(action) {
  console.log('[Renderer] Action clicked:', action);
  api.injectKey(action);
}

function toggleShift() {
  isShift = !isShift;
  currentLayout = isShift ? 'upper' : 'lower';
  renderKeyboard();
}

function switchLayout(layoutName) {
  currentLayout = layoutName;
  isShift = false;
  renderKeyboard();
}

/** Shows the keyboard of another language and resets shift and symbol state. */
function setKeyboardLanguage(langKey) {
  currentLangKey = LANGUAGES[langKey] ? langKey : DEFAULT_LANGUAGE;
  currentLayout = 'lower';
  isShift = false;
  renderKeyboard();
}

// Voice Typing Controls
micBtn.onclick = () => {
  api.toggleVoice();
};

// Microphone mode: 'toggle' stays on until pressed again; 'until-silence' stops by itself.
const micWave = document.getElementById('mic-wave');
const micLevels = document.getElementById('mic-levels');
const levelBars = micLevels ? micLevels.querySelectorAll('.level-bar') : [];

function applyVoiceMode(mode) {
  const stopsByItself = mode === 'until-silence';
  micBtn.classList.toggle('mode-until-silence', stopsByItself);
  micBtn.title = stopsByItself
    ? 'Voice Typing (F8) — stops automatically after silence'
    : 'Voice Typing (F8)';
  micBtn.setAttribute('aria-label', stopsByItself ? 'Voice typing, stops after silence' : 'Voice typing');
}

api.onVoiceMode(applyVoiceMode);

// Live audio level (0..1) from the microphone, while recording.
let targetLevel = 0;
let smoothLevel = 0;
let lastLevelAt = 0;
let levelAnimId = null;

api.onAudioLevel((level) => {
  if (typeof level !== 'number' || level < 0 || level > 1) return;
  targetLevel = level;
  lastLevelAt = Date.now();
});

/** Draws one frame of the level indicator; runs again until recording stops. */
function levelLoop(now) {
  if (!isRecording) {
    levelAnimId = null;
    return;
  }
  // No live levels (for example an older bridge): keep a gentle motion so it still looks alive.
  if (!lastLevelAt || Date.now() - lastLevelAt > 400) {
    targetLevel = 0.15 + 0.1 * Math.sin(now / 160);
  }
  smoothLevel += (targetLevel - smoothLevel) * 0.35;
  for (let i = 0; i < levelBars.length; i++) {
    const variation = 0.55 + 0.45 * Math.abs(Math.sin(now / 140 + i * 1.9));
    const scale = 0.2 + Math.min(1, Math.max(0, smoothLevel * variation * 1.6)) * 0.85;
    levelBars[i].style.transform = `scaleY(${scale.toFixed(3)})`;
  }
  micWave.style.transform = `scale(${(1 + smoothLevel * 0.7).toFixed(3)})`;
  micWave.style.opacity = `${Math.max(0.3, 1 - smoothLevel * 0.55).toFixed(3)}`;
  levelAnimId = requestAnimationFrame(levelLoop);
}

function startLevelLoop() {
  targetLevel = 0;
  smoothLevel = 0;
  if (levelAnimId === null) levelAnimId = requestAnimationFrame(levelLoop);
}

function stopLevelLoop() {
  if (levelAnimId !== null) {
    cancelAnimationFrame(levelAnimId);
    levelAnimId = null;
  }
  targetLevel = 0;
  smoothLevel = 0;
  for (let i = 0; i < levelBars.length; i++) levelBars[i].style.transform = 'scaleY(0.2)';
  micWave.style.transform = 'scale(1)';
  micWave.style.opacity = '1';
}

langSelect.onchange = (e) => {
  api.setLanguage(e.target.value);
  setKeyboardLanguage(e.target.value);
};

minimizeBtn.onclick = () => {
  isCollapsed = !isCollapsed;
  if (appContainer) {
    appContainer.classList.toggle('compact-mode', isCollapsed);
  }

  if (isCollapsed) {
    // Keyboard icon for expanding back
    compactIcon.innerHTML = '<path fill="currentColor" d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/>';
    minimizeBtn.title = "Expand to Full Keyboard";
  } else {
    // Mic in a pill: the compact floating bar in miniature
    compactIcon.innerHTML = '<path fill="currentColor" fill-rule="evenodd" d="M9 4h6a8 8 0 0 1 8 8 8 8 0 0 1-8 8H9a8 8 0 0 1-8-8 8 8 0 0 1 8-8zm0 2a6 6 0 0 0-6 6 6 6 0 0 0 6 6h6a6 6 0 0 0 6-6 6 6 0 0 0-6-6H9z"/><g transform="translate(6 6.25) scale(0.5)"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></g>';
    minimizeBtn.title = "Toggle Compact Floating Mode";
  }

  api.resizeWindow(isCollapsed);
};

if (hideBtn) {
  hideBtn.onclick = () => {
    api.hideToTray();
  };
}

closeBtn.onclick = () => {
  api.closeApp();
};

// Listen for speech status and text from main process
api.onVoiceState((state) => {
  isRecording = (state === 'listening');
  if (isRecording) transcriptInterim.classList.remove('transcript-error');
  micBtn.classList.toggle('recording', isRecording);
  if (isRecording) startLevelLoop();
  else stopLevelLoop();

  if (isRecording) {
    transcriptPlaceholder.style.display = 'none';
    transcriptInterim.innerText = 'Listening (speak now)...';
  } else {
    transcriptInterim.innerText = '';
    transcriptPlaceholder.style.display = 'inline';
    transcriptPlaceholder.innerText = 'Tap mic or press F8 to dictate...';
  }
});

api.onSpeechUpdate((data) => {
  if (data.interim) {
    transcriptPlaceholder.style.display = 'none';
    transcriptInterim.innerText = data.interim;
  }
  if (data.final) {
    transcriptInterim.innerText = data.final;
    setTimeout(() => {
      if (!isRecording) {
        transcriptInterim.innerText = '';
        transcriptPlaceholder.style.display = 'inline';
      }
    }, 2000);
  }
});

// Voice typing failed: show why, in the transcript area, for a few seconds.
let voiceErrorTimer = null;
api.onVoiceError((message) => {
  transcriptPlaceholder.style.display = 'none';
  transcriptInterim.innerText = message;
  transcriptInterim.classList.add('transcript-error');
  clearTimeout(voiceErrorTimer);
  voiceErrorTimer = setTimeout(() => {
    transcriptInterim.classList.remove('transcript-error');
    if (!isRecording) {
      transcriptInterim.innerText = '';
      transcriptPlaceholder.style.display = 'inline';
    }
  }, 7000);
});

// Version tooltip, the language and the microphone mode saved from the last session.
api.getInfo().then((info) => {
  const appLogo = document.getElementById('app-logo');
  if (appLogo) appLogo.title = `VoxKey v${info.version}`;
  if (info.language && [...langSelect.options].some((o) => o.value === info.language)) {
    langSelect.value = info.language;
  }
  setKeyboardLanguage(langSelect.value);
  applyVoiceMode(info.voiceMode);
});

// Clicking the logo opens the About window.
const appLogoEl = document.getElementById('app-logo');
if (appLogoEl) appLogoEl.addEventListener('click', () => api.openAbout());

// Initial render
renderKeyboard();
