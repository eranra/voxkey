const { ipcRenderer } = require('electron');

// Layout definitions
const LAYOUTS = {
  lower: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    [{ action: 'shift', label: '⇧' }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', { action: 'backspace', label: '⌫' }],
    [{ action: 'symbols', label: '?123' }, ',', { action: 'space', label: 'English' }, '.', { action: 'enter', label: '↵' }]
  ],
  upper: [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    [{ action: 'shift', label: '⬆', active: true }, 'Z', 'X', 'C', 'V', 'B', 'N', 'M', { action: 'backspace', label: '⌫' }],
    [{ action: 'symbols', label: '?123' }, ',', { action: 'space', label: 'English' }, '.', { action: 'enter', label: '↵' }]
  ],
  symbols: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['@', '#', '$', '%', '&', '-', '+', '(', ')'],
    [{ action: 'alt_symbols', label: '=\\<' }, '*', '"', '\'', ':', ';', '!', '?', { action: 'backspace', label: '⌫' }],
    [{ action: 'abc', label: 'ABC' }, ',', { action: 'space', label: 'English' }, '.', { action: 'enter', label: '↵' }]
  ],
  alt_symbols: [
    ['~', '`', '|', '•', '√', 'π', '÷', '×', '§', 'Δ'],
    ['£', '€', '¥', '¢', '^', '°', '=', '{', '}'],
    [{ action: 'symbols', label: '?123' }, '\\', '<', '>', '[', ']', '_', '—', { action: 'backspace', label: '⌫' }],
    [{ action: 'abc', label: 'ABC' }, ',', { action: 'space', label: 'English' }, '.', { action: 'enter', label: '↵' }]
  ]
};

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
  const rows = LAYOUTS[currentLayout];
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
          const langName = langSelect.options[langSelect.selectedIndex].text.split(' ')[0];
          keyEl.textContent = langName;
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
  ipcRenderer.send('inject-text', char);
  if (isShift && currentLayout === 'upper') {
    isShift = false;
    currentLayout = 'lower';
    renderKeyboard();
  }
}

function onActionClick(action) {
  console.log('[Renderer] Action clicked:', action);
  ipcRenderer.send('inject-key', action);
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

// Voice Typing Controls
micBtn.onclick = () => {
  ipcRenderer.send('toggle-voice');
};

langSelect.onchange = (e) => {
  ipcRenderer.send('set-lang', e.target.value);
  renderKeyboard();
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
    // Down chevron for compacting
    compactIcon.innerHTML = '<path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>';
    minimizeBtn.title = "Toggle Compact Floating Mode";
  }

  ipcRenderer.send('resize-window', { collapsed: isCollapsed });
};

if (hideBtn) {
  hideBtn.onclick = () => {
    ipcRenderer.send('hide-to-tray');
  };
}

closeBtn.onclick = () => {
  ipcRenderer.send('close-app');
};

// Listen for speech status and text from main process
ipcRenderer.on('voice-state', (event, state) => {
  isRecording = (state === 'listening');
  micBtn.classList.toggle('recording', isRecording);

  if (isRecording) {
    transcriptPlaceholder.style.display = 'none';
    transcriptInterim.innerText = 'Listening (speak now)...';
  } else {
    transcriptInterim.innerText = '';
    transcriptPlaceholder.style.display = 'inline';
    transcriptPlaceholder.innerText = 'Tap mic or press F8 to dictate...';
  }
});

ipcRenderer.on('speech-update', (event, data) => {
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

// Update dynamic version tooltip
try {
  const pkg = require('../package.json');
  const appLogo = document.getElementById('app-logo') || document.getElementById('g-logo');
  if (appLogo && pkg.version) {
    appLogo.title = `VoxKey v${pkg.version}`;
  }
} catch (e) {}

// Initial render
renderKeyboard();
