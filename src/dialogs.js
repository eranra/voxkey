/**
 * Shows message boxes so that the user can always see them.
 *
 * Without care, a message box hides behind the keyboard window: the keyboard is always on top at the
 * highest level ('screen-saver'). On macOS a message box without a parent window is also modal: it blocks
 * the main process (typing, dictation, the local API) until it is closed. A hidden one makes VoxKey freeze.
 *
 * - Normally the message box is attached to a parent window (the About window) as a sheet. A sheet is
 *   visible above the keyboard and does not block the main process.
 * - Only if no parent can be opened: the keyboard window leaves the top level while the message box is
 *   open, and VoxKey comes to the front on macOS. The keyboard goes back on top afterwards.
 *
 * `deps`: { dialog, app, platform, getParent(): BrowserWindow|null|Promise, getKeyboard(): BrowserWindow|null }
 */
function createDialogs(deps) {
  const platform = deps.platform || process.platform;

  async function showMessageBox(options) {
    const parent = usable(deps.getParent ? await deps.getParent() : null);
    if (parent) {
      return deps.dialog.showMessageBox(parent, options);
    }

    const keyboard = usable(deps.getKeyboard && deps.getKeyboard());
    const lowered = Boolean(keyboard && keyboard.isAlwaysOnTop());
    if (lowered) keyboard.setAlwaysOnTop(false);
    if (platform === 'darwin' && deps.app && deps.app.focus) deps.app.focus({ steal: true });
    try {
      return await deps.dialog.showMessageBox(options);
    } finally {
      if (lowered && !keyboard.isDestroyed()) keyboard.setAlwaysOnTop(true, 'screen-saver');
    }
  }

  return { showMessageBox };
}

function usable(win) {
  return win && !win.isDestroyed() ? win : null;
}

module.exports = {
  createDialogs
};
