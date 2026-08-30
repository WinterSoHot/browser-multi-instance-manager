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

function createHandlerFixture({
  profileService: profileOverrides = {},
  browserProcessManager: processOverrides = {},
  settingsService: settingsOverrides = {},
} = {}) {
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
      list: () => [],
      add: () => {},
      remove: () => {},
      launch: () => {},
      rename: () => {},
      openFolder: () => {},
      cloneBlank: () => {},
      size: () => {},
      exportMetadata: () => {},
      importMetadata: () => {},
      ...profileOverrides,
    },
    browserProcessManager: {
      close: () => {},
      getStatus: () => {},
      getStatuses: () => {},
      forget: () => {},
      ...processOverrides,
    },
    settingsService: {
      get: () => ({}),
      set: () => {},
      getDefaultPath: () => '',
      getPlatform: () => 'test',
      getEnvironment: () => ({}),
      browseFolder: () => {},
      ...settingsOverrides,
    },
  };

  const unregister = registerIpcHandlers(dependencies);

  return { handlers, unregister };
}

test('registers each existing IPC channel once and unregisters cleanly', () => {
  const { handlers, unregister } = createHandlerFixture({
    profileService: {
      list: () => [{ id: 'profile-1' }],
    },
  });

  assert.deepEqual([...handlers.keys()], expectedChannels);
  assert.deepEqual(handlers.get('get-profiles')({}, undefined), [{ id: 'profile-1' }]);

  unregister();

  assert.equal(handlers.size, 0);
});

test('profile IPC delegates the original payload and forwards the service result', async () => {
  const payload = { browserType: 'chrome', profileName: 'Work' };
  const serviceResult = { success: true, profile: { id: 'profile-1' } };
  let receivedPayload;
  const { handlers } = createHandlerFixture({
    profileService: {
      add(received) {
        receivedPayload = received;
        return serviceResult;
      },
    },
  });

  const result = await handlers.get('add-profile')({}, payload);

  assert.equal(receivedPayload, payload);
  assert.equal(result, serviceResult);
});

test('process IPC validates bulk IDs and forwards refresh options', async () => {
  const statusCalls = [];
  const { handlers } = createHandlerFixture({
    browserProcessManager: {
      getStatuses(profileIds) {
        statusCalls.push({ method: 'getStatuses', profileIds });
        return { 'profile-1': { running: true } };
      },
      getStatus(profileId, options) {
        statusCalls.push({ method: 'getStatus', profileId, options });
        return { running: false };
      },
    },
  });

  assert.deepEqual(
    await handlers.get('get-browser-statuses')({}, ['profile-1', 'profile-1']),
    { 'profile-1': { running: true } },
  );
  assert.deepEqual(
    await handlers.get('refresh-browser-status')({}, 'profile-2'),
    { running: false },
  );
  assert.deepEqual(statusCalls, [
    { method: 'getStatuses', profileIds: ['profile-1'] },
    { method: 'getStatus', profileId: 'profile-2', options: { force: true } },
  ]);
});

test('settings IPC delegates payloads and forwards environment results', async () => {
  const settings = { chrome: '/Applications/Google Chrome.app' };
  const environment = {
    platform: 'darwin',
    settings,
    defaultPaths: {},
    validity: { chrome: true },
  };
  let receivedSettings;
  const { handlers } = createHandlerFixture({
    settingsService: {
      set(received) {
        receivedSettings = received;
        return { success: true };
      },
      getEnvironment: () => environment,
    },
  });

  assert.deepEqual(
    await handlers.get('set-browser-settings')({}, settings),
    { success: true },
  );
  assert.equal(receivedSettings, settings);
  assert.equal(
    await handlers.get('get-browser-environment')({}, undefined),
    environment,
  );
});
