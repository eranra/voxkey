const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildTrayMenuModel, toMenuTemplate, TRAY_ICON_SIZE } = require('../../src/trayManager');

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

  it('becomes an Electron template whose clicks run the command', () => {
    const ran = [];
    const template = toMenuTemplate(buildTrayMenuModel({ version: '1.0.0' }), (c) => ran.push(c));
    assert.strictEqual(template[0].enabled, false);
    assert.strictEqual(template[0].click, undefined);
    template.find((i) => i.label === 'About VoxKey').click();
    template.find((i) => i.type === 'checkbox').click();
    assert.deepStrictEqual(ran, ['about', 'toggleAutoUpdate']);
  });

  it('uses a small icon, not the 1024 px app icon', () => {
    assert.ok(TRAY_ICON_SIZE <= 32);
  });
});
