const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppSettingsController } = require('../renderer/app-settings-controller');

test('settings controller keeps the saved close-to-tray value after a successful change', async () => {
  const controller = createAppSettingsController({
    getAppSettings: async () => ({ closeToTray: true }),
    setAppSettings: async () => ({ success: true, settings: { closeToTray: false } }),
  });

  assert.deepEqual(await controller.load(), { closeToTray: true });
  assert.deepEqual(await controller.save({ closeToTray: false }), {
    success: true,
    settings: { closeToTray: false },
  });
});

test('settings controller restores the last persisted value after a failed change', async () => {
  const controller = createAppSettingsController({
    getAppSettings: async () => ({ closeToTray: true }),
    setAppSettings: async () => ({ success: false, error: '/private/settings.json' }),
  });

  await controller.load();
  assert.deepEqual(await controller.save({ closeToTray: false }), {
    success: false,
    settings: { closeToTray: true },
    error: 'Unable to save app settings',
  });
});
