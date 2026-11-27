const { SIZES, PATHS } = require('./config');

/**
 * Pure function to calculate clamped window bounds for full or compact mode.
 */
function calculateBounds(screenWidth, screenHeight, isCompact, userCompactPos = null, userFullPos = null) {
  const width = isCompact ? SIZES.compact.width : SIZES.full.width;
  const height = isCompact ? SIZES.compact.height : SIZES.full.height;

  let x, y;
  if (isCompact) {
    if (userCompactPos && userCompactPos.x !== null && userCompactPos.y !== null) {
      x = userCompactPos.x;
      y = userCompactPos.y;
    } else {
      // Default: bottom right corner with margin
      x = screenWidth - width - 30;
      y = screenHeight - height - 20;
    }
  } else {
    if (userFullPos && userFullPos.x !== null && userFullPos.y !== null) {
      x = userFullPos.x;
      y = userFullPos.y;
    } else {
      // Default: centered at bottom with 16px bottom margin
      x = Math.round((screenWidth - width) / 2);
      y = screenHeight - height - 16;
    }
  }

  // Strict viewport boundary clamping
  const minX = 10;
  const maxX = Math.max(minX, screenWidth - width - 10);
  const minY = 10;
  const maxY = Math.max(minY, screenHeight - height - 10);

  x = Math.max(minX, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));

  return { x, y, width, height };
}

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.isCompact = false;
    this.userCompactPos = { x: null, y: null };
    this.userFullPos = { x: null, y: null };
  }

  createWindow(BrowserWindow, screenModule, startMinimized = false) {
    const primaryDisplay = screenModule.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const bounds = calculateBounds(screenWidth, screenHeight, false);

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
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
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
      const primaryDisplay = electronScreen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

      const [curW, curH] = this.mainWindow.getSize();
      const [curX, curY] = this.mainWindow.getPosition();

      const maxX = Math.max(10, screenWidth - curW - 10);
      const maxY = Math.max(10, screenHeight - curH - 10);

      const clampedX = Math.max(10, Math.min(curX, maxX));
      const clampedY = Math.max(10, Math.min(curY, maxY));

      if (clampedX !== curX || clampedY !== curY) {
        this.mainWindow.setPosition(clampedX, clampedY);
      }
    } catch (e) {
      // Fallback if screen API is unavailable in tests
    }
  }

  resize(screenModule, collapsed) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const primaryDisplay = screenModule.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const [curX, curY] = this.mainWindow.getPosition();

    if (collapsed) {
      // Save current full keyboard position
      this.userFullPos = { x: curX, y: curY };
      this.isCompact = true;

      const bounds = calculateBounds(screenWidth, screenHeight, true, this.userCompactPos, this.userFullPos);
      this.mainWindow.setSize(bounds.width, bounds.height);
      this.mainWindow.setPosition(bounds.x, bounds.y);
    } else {
      // Save current compact position (where user might have moved the pill)
      this.userCompactPos = { x: curX, y: curY };
      this.isCompact = false;

      const bounds = calculateBounds(screenWidth, screenHeight, false, this.userCompactPos, this.userFullPos);
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
  WindowManager
};
