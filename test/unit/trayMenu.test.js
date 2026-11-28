const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { buildTrayMenuModel, toMenuTemplate, trayIconFile } = require('../../src/trayManager');

describe('tray menu', () => {
  it('has keyboard, voice, About and update items', () => {
    const model = buildTrayMenuModel({ version: '1.2.3' });
    assert.deepStrictEqual(model[0], { label: 'VoxKey v1.2.3', enabled: false });
    const commands = model.filter((i) => i.command).map((i) => i.command);
    assert.deepStrictEqual(commands, ['toggleKeyboard', 'toggleVoice', 'about', 'checkUpdates', 'toggleAutoUpdate', 'quit']);
  });

  it('shows an available update first', () => {
    const model = buildTrayMenuModel({ version: '1.2.3', updateLabel: 'Update Available: 1.3.0…' });
    assert.deepStrictEqual(model[0], { label: 'Update Available: 1.3.0…', command: 'update' });
    assert.strictEqual(model[1].type, 'separator');
  });

  it('the automatic-check item follows the setting', () => {
    const find = (m) => m.find((i) => i.command === 'toggleAutoUpdate');
    assert.strictEqual(find(buildTrayMenuModel({ checkForUpdates: true })).checked, true);
    assert.strictEqual(find(buildTrayMenuModel({ checkForUpdates: false })).checked, false);
  });

  it('offers the microphone modes as radio items, one checked', () => {
    const submenu = buildTrayMenuModel({ voiceMode: 'toggle', platform: 'win32' })
      .find((i) => i.label === 'Voice Typing Mode').submenu;
    assert.deepStrictEqual(submenu.map((i) => i.command), ['setVoiceModeToggle', 'setVoiceModeUntilSilence']);
    assert.strictEqual(submenu.every((i) => i.type === 'radio'), true);
    assert.strictEqual(submenu.filter((i) => i.checked).length, 1);

    const auto = buildTrayMenuModel({ voiceMode: 'until-silence', platform: 'win32' })
      .find((i) => i.label === 'Voice Typing Mode').submenu;
    assert.strictEqual(auto.find((i) => i.command === 'setVoiceModeUntilSilence').checked, true);
    assert.strictEqual(auto.find((i) => i.command === 'setVoiceModeToggle').checked, false);
    const fallback = buildTrayMenuModel({ platform: 'win32' }).find((i) => i.label === 'Voice Typing Mode').submenu;
    assert.strictEqual(fallback.find((i) => i.command === 'setVoiceModeToggle').checked, true, 'unknown mode falls back to toggle');
  });

  it('macOS also offers hold-to-talk, and marks the checked mode', () => {
    const submenu = buildTrayMenuModel({ voiceMode: 'hold', platform: 'darwin' })
      .find((i) => i.label === 'Voice Typing Mode').submenu;
    assert.deepStrictEqual(
      submenu.map((i) => i.command),
      ['setVoiceModeToggle', 'setVoiceModeUntilSilence', 'setVoiceModeHold']
    );
    assert.strictEqual(submenu.find((i) => i.command === 'setVoiceModeHold').checked, true);
    assert.strictEqual(submenu.filter((i) => i.checked).length, 1);
    // Windows does not get the hold option (it needs the macOS key-state helper).
    const win = buildTrayMenuModel({ voiceMode: 'hold', platform: 'win32' })
      .find((i) => i.label === 'Voice Typing Mode').submenu;
    assert.ok(!win.some((i) => i.command === 'setVoiceModeHold'));
  });

  it('offers the voice shortcuts, with the configured one checked', () => {
    const submenu = buildTrayMenuModel({ voiceShortcut: 'rightOption', platform: 'darwin' })
      .find((i) => i.label === 'Voice Shortcut').submenu;
    assert.ok(submenu.length >= 3);
    assert.ok(submenu.every((i) => i.type === 'radio'));
    assert.strictEqual(submenu.find((i) => i.command === 'setVoiceShortcut:rightOption').checked, true);
    assert.strictEqual(submenu.find((i) => i.command === 'setVoiceShortcut:f8').checked, false);
    // The right-side modifier shortcuts are macOS only.
    const win = buildTrayMenuModel({ platform: 'win32' }).find((i) => i.label === 'Voice Shortcut').submenu;
    assert.ok(win.every((i) => !i.command.includes('rightOption') && !i.command.includes('rightCommand')));
  });

  it('the toggle item names the configured shortcut', () => {
    const model = buildTrayMenuModel({ voiceShortcut: 'rightOption', platform: 'darwin' });
    assert.match(model.find((i) => i.command === 'toggleVoice').label, /Right Option/);
  });

  it('becomes an Electron template whose clicks run the command', () => {
    const ran = [];
    const template = toMenuTemplate(
      buildTrayMenuModel({ version: '1.0.0', voiceMode: 'until-silence', platform: 'win32' }),
      (c) => ran.push(c)
    );
    assert.strictEqual(template[0].enabled, false);
    assert.strictEqual(template[0].click, undefined);
    template.find((i) => i.label === 'About VoxKey').click();
    template.find((i) => i.type === 'checkbox').click();
    assert.deepStrictEqual(ran, ['about', 'toggleAutoUpdate']);

    // The mode submenu becomes a real submenu with radio items that run commands.
    const modeItem = template.find((i) => i.label === 'Voice Typing Mode');
    assert.strictEqual(modeItem.submenu.length, 2);
    const radios = modeItem.submenu.filter((i) => i.type === 'radio');
    assert.deepStrictEqual(radios.map((i) => i.checked), [false, true]);
    radios[1].click();
    assert.deepStrictEqual(ran, ['about', 'toggleAutoUpdate', 'setVoiceModeUntilSilence']);

    // Shortcut submenu items run their command too.
    const shortcutItem = template.find((i) => i.label === 'Voice Shortcut');
    shortcutItem.submenu[0].click();
    assert.deepStrictEqual(ran.at(-1), 'setVoiceShortcut:f8');
  });

  it('uses a small tray icon for each system, not the 1024 px app icon', () => {
    assert.match(trayIconFile('darwin'), /trayTemplate\.png$/);
    assert.match(trayIconFile('win32'), /[\\/]tray\.png$/);
    for (const file of [trayIconFile('darwin'), trayIconFile('win32')]) {
      assert.ok(fs.existsSync(file), file);
      assert.ok(fs.existsSync(file.replace('.png', '@2x.png')), `${file} @2x`);
    }
  });
});
