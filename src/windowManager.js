const { SIZES, PATHS } = require('./config');

/**
 * Settings for every VoxKey window: no Node.js in the page, and only the small API in
 * renderer/preload.js. A page bug can then never run programs or read files.
 */
function secureWebPreferences() {
  return {
    preload: PATHS.preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true
  };
}

/**
 * Calculates the window bounds for full or compact mode, clamped inside the display's work area.
 * `origin` is the top-left corner of the work area. It is not (0, 0) on macOS (the menu bar) or
 * when the primary display is not the left-most one.
 */
function calculateBounds(screenWidth, screenHeight, isCompact, userCompactPos = null, userFullPos = null, origin = { x: 0, y: 0 }) {
  const width = isCompact ? SIZES.compact.width : SIZES.full.width;
  const height = isCompact ? SIZES.compact.height : SIZES.full.height;
  const hasPos = (p) => p && p.x !== null && p.y !== null && p.x !== undefined && p.y !== undefined;

  let x, y;
  const userPos = isCompact ? userCompactPos : userFullPos;
  if (hasPos(userPos)) {
    x = userPos.x;
    y = userPos.y;
  } else if (isCompact) {
    // Default: bottom right corner with margin
    x = origin.x + screenWidth - width - 30;
    y = origin.y + screenHeight - height - 20;
  } else {
    // Default: centered at bottom with 16px bottom margin
    x = origin.x + Math.round((screenWidth - width) / 2);
    y = origin.y + screenHeight - height - 16;
  }

  return { ...clampToArea(x, y, width, height, { x: origin.x, y: origin.y, width: screenWidth, height: screenHeight }), width, height };
}

/** Keeps a width x height window at least 10 px inside `area` (when it fits). */
function clampToArea(x, y, width, height, area) {
  const minX = area.x + 10;
  const maxX = Math.max(minX, area.x + area.width - width - 10);
  const minY = area.y + 10;
  const maxY = Math.max(minY, area.y + area.height - height - 10);
  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY))
  };
}

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.isCompact = false;
    this.userCompactPos = { x: null, y: null };
    this.userFullPos = { x: null, y: null };
  }

  createWindow(BrowserWindow, screenModule, startMinimized = false) {
    const area = screenModule.getPrimaryDisplay().workArea;
    const bounds = calculateBounds(area.width, area.height, false, null, null, area);

    this.mainWindow = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false, // Ensures typing clicks never steal focus from target applications
      resizable: true, // Enables smooth setSize transitions between compact pill and full layout
      skipTaskbar: false,
      show: false, // Keep hidden until ready-to-show to prevent visual flash
      webPreferences: secureWebPreferences()
    });

    this.mainWindow.loadFile(PATHS.rendererIndex);

    this.mainWindow.once('ready-to-show', () => {
      if (!startMinimized) {
        this.show();
      } else {
        console.log('[WindowManager] Initialized in background (tray mode).');
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    return this.mainWindow;
  }

  show() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }

    // Safety: ensure current coordinates are within visible display
    this.ensureInBounds();

    this.mainWindow.show();
    this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  hide() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.hide();
  }

  toggle(screenModule, forceShow = false) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const isHidden = !this.mainWindow.isVisible() || this.mainWindow.isMinimized();

    if (forceShow || isHidden) {
      this.show();
    } else {
      this.hide();
    }
  }

  ensureInBounds(screenModule = null) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    try {
      const electronScreen = screenModule || require('electron').screen;
      const area = electronScreen.getPrimaryDisplay().workArea;
      const [curW, curH] = this.mainWindow.getSize();
      const [curX, curY] = this.mainWindow.getPosition();
      const { x: clampedX, y: clampedY } = clampToArea(curX, curY, curW, curH, area);

      if (clampedX !== curX || clampedY !== curY) {
        this.mainWindow.setPosition(clampedX, clampedY);
      }
    } catch (e) {
      // Fallback if screen API is unavailable in tests
    }
  }

  resize(screenModule, collapsed) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const area = screenModule.getPrimaryDisplay().workArea;
    const [curX, curY] = this.mainWindow.getPosition();

    if (collapsed) {
      // Save current full keyboard position
      this.userFullPos = { x: curX, y: curY };
      this.isCompact = true;

      const bounds = calculateBounds(area.width, area.height, true, this.userCompactPos, this.userFullPos, area);
      this.mainWindow.setSize(bounds.width, bounds.height);
      this.mainWindow.setPosition(bounds.x, bounds.y);
    } else {
      // Save current compact position (where user might have moved the pill)
      this.userCompactPos = { x: curX, y: curY };
      this.isCompact = false;

      const bounds = calculateBounds(area.width, area.height, false, this.userCompactPos, this.userFullPos, area);
      this.mainWindow.setSize(bounds.width, bounds.height);
      this.mainWindow.setPosition(bounds.x, bounds.y);
    }

    this.show();
  }

  getWindow() {
    return this.mainWindow;
  }
}

module.exports = {
  calculateBounds,
  clampToArea,
  secureWebPreferences,
  WindowManager
};
