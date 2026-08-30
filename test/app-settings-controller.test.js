const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppSettingsController } = require('../renderer/app-settings-controller');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

test('settings controller keeps saving disabled until a deferred persisted false value loads', async () => {
  const deferredSettings = createDeferred();
  let saveCalls = 0;
  const controller = createAppSettingsController({
    getAppSettings: () => deferredSettings.promise,
    setAppSettings: async () => {
      saveCalls += 1;
      return { success: true, settings: { closeToTray: true } };
    },
  });

  const loading = controller.load();
  assert.equal(controller.isLoaded(), false);
  assert.deepEqual(await controller.save({ closeToTray: true }), {
    success: false,
    settings: { closeToTray: true },
    error: 'Unable to save app settings',
  });
  assert.equal(saveCalls, 0);

  deferredSettings.resolve({ closeToTray: false });
  assert.deepEqual(await loading, { closeToTray: false });
  assert.equal(controller.isLoaded(), true);
});

test('settings controller uses a stable fallback after load rejection and rolls a failed save back to false', async () => {
  const controller = createAppSettingsController({
    getAppSettings: async () => ({ closeToTray: false, checkUpdatesOnStartup: true }),
    setAppSettings: async () => ({ success: false }),
  });

  assert.deepEqual(await controller.load(), { closeToTray: false });
  assert.deepEqual(await controller.save({ closeToTray: true }), {
    success: false,
    settings: { closeToTray: false },
    error: 'Unable to save app settings',
  });

  const rejected = createAppSettingsController({
    getAppSettings: async () => { throw new Error('/private/settings.json'); },
    setAppSettings: async () => ({ success: true, settings: { closeToTray: false } }),
  });
  assert.deepEqual(await rejected.load(), { closeToTray: true });
  assert.equal(rejected.isLoaded(), true);
});
