const test = require('node:test');
const assert = require('node:assert/strict');

const { createAsyncQueue } = require('../lib/async-queue');
const { createAppSettingsService } = require('../lib/app-settings-service');
const { createAppLifecycle } = require('../lib/app-lifecycle');

function createAppStore(initial = { closeToTray: true, checkUpdatesOnStartup: true }) {
  let settings = structuredClone(initial);
  const writes = [];
  return {
    getAppSettings: () => structuredClone(settings),
    setAppSettings(next) {
      writes.push(structuredClone(next));
      settings = structuredClone(next);
    },
    getWrites: () => structuredClone(writes),
  };
}

test('app settings service returns defensive copies and applies a strict partial patch', async () => {
  const appStore = createAppStore();
  const service = createAppSettingsService({ appStore, enqueueMutation: createAsyncQueue() });

  const settings = service.get();
  settings.closeToTray = false;
  assert.deepEqual(service.get(), { closeToTray: true, checkUpdatesOnStartup: true });
  assert.deepEqual(await service.set({ closeToTray: false }), {
    success: true,
    settings: { closeToTray: false, checkUpdatesOnStartup: true },
  });
  await assert.rejects(service.set({ closeToTray: 'false' }), /Invalid app settings/u);
  await assert.rejects(service.set({ unknown: true }), /Invalid app settings/u);
  await assert.rejects(service.set({}), /Invalid app settings/u);
  assert.deepEqual(appStore.getWrites(), [{ closeToTray: false, checkUpdatesOnStartup: true }]);
});

test('app settings service serializes concurrent patches against the current stored settings', async () => {
  const appStore = createAppStore();
  const service = createAppSettingsService({ appStore, enqueueMutation: createAsyncQueue() });

  const first = service.set({ closeToTray: false });
  const second = service.set({ checkUpdatesOnStartup: false });

  await Promise.all([first, second]);
  assert.deepEqual(appStore.getWrites(), [
    { closeToTray: false, checkUpdatesOnStartup: true },
    { closeToTray: false, checkUpdatesOnStartup: false },
  ]);
  assert.deepEqual(service.get(), { closeToTray: false, checkUpdatesOnStartup: false });
});

test('a saved close-to-tray change is observed by the lifecycle without restarting', async () => {
  const appStore = createAppStore();
  const service = createAppSettingsService({ appStore, enqueueMutation: createAsyncQueue() });
  const lifecycle = createAppLifecycle({
    platform: 'darwin',
    getCloseToTray: () => appStore.getAppSettings().closeToTray !== false,
    getActiveStatusCount: () => ({ running: 0, unknown: 0 }),
    confirmExit: async () => true,
    hideWindow: () => assert.fail('disabled close-to-tray must not hide the window'),
    destroyTray: () => {},
    quitApp: () => {},
  });
  const closeEvent = {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };

  await service.set({ closeToTray: false });
  assert.equal(await lifecycle.handleWindowClose(closeEvent), false);
  assert.equal(closeEvent.defaultPrevented, false);
});
