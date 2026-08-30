const test = require('node:test');
const assert = require('node:assert/strict');

const { registerIpcHandlers } = require('../lib/ipc-handlers');

const expectedChannels = [
  'get-profiles',
  'add-profile',
  'delete-profile',
  'launch-browser',
  'close-browser',
  'get-browser-status',
  'get-browser-statuses',
  'refresh-browser-status',
  'forget-browser-process',
  'rename-profile',
  'open-profile-folder',
  'clone-profile',
  'get-profile-size',
  'export-profiles',
  'import-profiles',
  'get-browser-settings',
  'set-browser-settings',
  'get-default-browser-path',
  'get-platform',
  'get-browser-environment',
  'browse-folder',
];

test('registers each existing IPC channel once and unregisters cleanly', () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `${channel} registered more than once`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
  const dependencies = {
    ipcMain,
    profileService: {
      list: () => [{ id: 'profile-1' }],
      add: () => {},
      remove: () => {},
      launch: () => {},
      rename: () => {},
      openFolder: () => {},
      cloneBlank: () => {},
      size: () => {},
      exportMetadata: () => {},
      importMetadata: () => {},
    },
    browserProcessManager: {
      close: () => {},
      getStatus: () => {},
      getStatuses: () => {},
      forget: () => {},
    },
    settingsService: {
      get: () => ({}),
      set: () => {},
      getDefaultPath: () => '',
      getPlatform: () => 'test',
      getEnvironment: () => ({}),
      browseFolder: () => {},
    },
  };

  const unregister = registerIpcHandlers(dependencies);

  assert.deepEqual([...handlers.keys()], expectedChannels);
  assert.deepEqual(handlers.get('get-profiles')({}, undefined), [{ id: 'profile-1' }]);

  unregister();

  assert.equal(handlers.size, 0);
});
