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

  it('offers the two microphone modes as radio items, one checked', () => {
    const submenu = buildTrayMenuModel({ voiceMode: 'toggle' }).find((i) => i.label === 'Voice Typing Mode').submenu;
    assert.deepStrictEqual(submenu.map((i) => i.command), ['setVoiceModeToggle', 'setVoiceModeUntilSilence']);
    assert.strictEqual(submenu.every((i) => i.type === 'radio'), true);
    assert.strictEqual(submenu.filter((i) => i.checked).length, 1);

    const auto = buildTrayMenuModel({ voiceMode: 'until-silence' }).find((i) => i.label === 'Voice Typing Mode').submenu;
    assert.strictEqual(auto.find((i) => i.command === 'setVoiceModeUntilSilence').checked, true);
    assert.strictEqual(auto.find((i) => i.command === 'setVoiceModeToggle').checked, false);

    const fallback = buildTrayMenuModel({}).find((i) => i.label === 'Voice Typing Mode').submenu;
    assert.strictEqual(fallback.find((i) => i.command === 'setVoiceModeToggle').checked, true, 'unknown mode falls back to toggle');
  });

  it('becomes an Electron template whose clicks run the command', () => {
    const ran = [];
    const template = toMenuTemplate(buildTrayMenuModel({ version: '1.0.0', voiceMode: 'until-silence' }), (c) => ran.push(c));
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
