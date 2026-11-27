const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createDialogs } = require('../../src/dialogs');

function fakeWindow({ onTop = true } = {}) {
  const calls = [];
  return {
    calls,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    isAlwaysOnTop: () => onTop,
    setAlwaysOnTop: (...args) => { onTop = args[0]; calls.push(args); }
  };
}

describe('message boxes', () => {
  it('attach to the About window when it is open, as a sheet', async () => {
    const about = fakeWindow();
    const keyboard = fakeWindow();
    const seen = [];
    const dialogs = createDialogs({
      platform: 'darwin',
      dialog: { showMessageBox: async (...args) => { seen.push(args); return { response: 0 }; } },
      getParent: () => about,
      getKeyboard: () => keyboard
    });
    await dialogs.showMessageBox({ message: 'hi' });
    assert.strictEqual(seen[0][0], about);
    assert.deepStrictEqual(keyboard.calls, [], 'keyboard stays on top');
  });

  it('waits for a parent window that is still opening', async () => {
    const about = fakeWindow();
    const seen = [];
    const dialogs = createDialogs({
      dialog: { showMessageBox: async (...args) => { seen.push(args); return { response: 0 }; } },
      getParent: () => new Promise((r) => setTimeout(() => r(about), 5)),
      getKeyboard: () => fakeWindow()
    });
    await dialogs.showMessageBox({ message: 'hi' });
    assert.strictEqual(seen[0][0], about);
  });

  it('without a parent, move the keyboard off the top while open, then put it back', async () => {
    const keyboard = fakeWindow();
    const focused = [];
    let onTopWhileOpen;
    const dialogs = createDialogs({
      platform: 'darwin',
      app: { focus: (o) => focused.push(o) },
      dialog: {
        showMessageBox: async (opts) => {
          onTopWhileOpen = keyboard.isAlwaysOnTop();
          return { response: 1, opts };
        }
      },
      getParent: () => null,
      getKeyboard: () => keyboard
    });
    const result = await dialogs.showMessageBox({ message: "You're up to date" });
    assert.strictEqual(result.response, 1);
    assert.strictEqual(onTopWhileOpen, false);
    assert.deepStrictEqual(keyboard.calls, [[false], [true, 'screen-saver']]);
    assert.deepStrictEqual(focused, [{ steal: true }]);
  });

  it('puts the keyboard back on top even when the message box fails', async () => {
    const keyboard = fakeWindow();
    const dialogs = createDialogs({
      platform: 'win32',
      dialog: { showMessageBox: async () => { throw new Error('boom'); } },
      getKeyboard: () => keyboard
    });
    await assert.rejects(dialogs.showMessageBox({}), /boom/);
    assert.deepStrictEqual(keyboard.calls.at(-1), [true, 'screen-saver']);
  });

  it('leaves a hidden or closed keyboard alone', async () => {
    const closed = fakeWindow();
    closed.destroyed = true;
    const dialogs = createDialogs({
      platform: 'win32',
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      getParent: () => closed,
      getKeyboard: () => closed
    });
    await dialogs.showMessageBox({});
    assert.deepStrictEqual(closed.calls, []);
  });
});
