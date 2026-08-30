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
  'get-workspaces',
  'create-workspace',
  'rename-workspace',
  'delete-workspace',
  'assign-profile-workspace',
  'set-profile-favorite',
];

function createHandlerFixture({
  profileService: profileOverrides = {},
  browserProcessManager: processOverrides = {},
  settingsService: settingsOverrides = {},
  workspaceService: workspaceOverrides = {},
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
    workspaceService: {
      list: () => [],
      create: () => {},
      rename: () => {},
      remove: () => {},
      assign: () => {},
      setFavorite: () => {},
      ...workspaceOverrides,
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

test('process IPC validates bulk IDs and forwards optional forced snapshots', async () => {
  const statusCalls = [];
  const { handlers } = createHandlerFixture({
    browserProcessManager: {
      getStatuses(profileIds, options) {
        statusCalls.push({ method: 'getStatuses', profileIds, options });
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
    await handlers.get('get-browser-statuses')({}, ['profile-3'], { force: true }),
    { 'profile-1': { running: true } },
  );
  assert.throws(
    () => handlers.get('get-browser-statuses')({}, ['profile-4'], { force: 'true' }),
    /Invalid browser status options/,
  );
  assert.deepEqual(
    await handlers.get('refresh-browser-status')({}, 'profile-2'),
    { running: false },
  );
  assert.deepEqual(statusCalls, [
    { method: 'getStatuses', profileIds: ['profile-1'], options: { force: false } },
    { method: 'getStatuses', profileIds: ['profile-3'], options: { force: true } },
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

test('workspace IPC delegates narrow payloads and rejects invalid identifiers or favorites', async () => {
  const calls = [];
  const workspaces = [{ id: 'workspace-1', name: 'Work' }];
  const { handlers } = createHandlerFixture({
    workspaceService: {
      list: () => workspaces,
      create(payload) {
        calls.push({ method: 'create', payload });
        return { success: true };
      },
      rename(payload) {
        calls.push({ method: 'rename', payload });
        return { success: true };
      },
      remove(payload) {
        calls.push({ method: 'remove', payload });
        return { success: true };
      },
      assign(payload) {
        calls.push({ method: 'assign', payload });
        return { success: true };
      },
      setFavorite(payload) {
        calls.push({ method: 'setFavorite', payload });
        return { success: true };
      },
    },
  });

  assert.equal(await handlers.get('get-workspaces')({}, undefined), workspaces);
  assert.deepEqual(
    await handlers.get('create-workspace')({}, { name: 'Work' }),
    { success: true },
  );
  assert.deepEqual(
    await handlers.get('rename-workspace')({}, { workspaceId: 'workspace-1', name: 'Projects' }),
    { success: true },
  );
  assert.deepEqual(
    await handlers.get('delete-workspace')({}, { workspaceId: 'workspace-1' }),
    { success: true },
  );
  assert.deepEqual(
    await handlers.get('assign-profile-workspace')({}, {
      profileId: 'profile-1',
      workspaceId: null,
    }),
    { success: true },
  );
  assert.deepEqual(
    await handlers.get('set-profile-favorite')({}, { profileId: 'profile-1', favorite: true }),
    { success: true },
  );
  assert.deepEqual(calls, [
    { method: 'create', payload: { name: 'Work' } },
    { method: 'rename', payload: { workspaceId: 'workspace-1', name: 'Projects' } },
    { method: 'remove', payload: { workspaceId: 'workspace-1' } },
    { method: 'assign', payload: { profileId: 'profile-1', workspaceId: null } },
    { method: 'setFavorite', payload: { profileId: 'profile-1', favorite: true } },
  ]);
  assert.deepEqual(
    await handlers.get('assign-profile-workspace')({}, {
      profileId: 'profile-1',
      workspaceId: '',
    }),
    { success: false, error: 'Invalid workspace ID' },
  );
  assert.deepEqual(
    await handlers.get('set-profile-favorite')({}, { profileId: 'profile-1', favorite: 'true' }),
    { success: false, error: 'Invalid favorite value' },
  );
});

test('workspace IPC returns a safe result when an asynchronous service operation rejects', async () => {
  const { handlers } = createHandlerFixture({
    workspaceService: {
      create: async () => {
        throw new Error('Workspace persistence failed');
      },
    },
  });

  assert.deepEqual(
    await handlers.get('create-workspace')({}, { name: 'Work' }),
    { success: false, error: 'Workspace request failed' },
  );
});

test('workspace IPC sanitizes null, undefined, and non-Error promise rejections', async () => {
  for (const rejection of [null, undefined, 'raw system failure', { message: '/private/path' }]) {
    const { handlers } = createHandlerFixture({
      workspaceService: {
        create: () => Promise.reject(rejection),
      },
    });

    assert.deepEqual(
      await handlers.get('create-workspace')({}, { name: 'Work' }),
      { success: false, error: 'Workspace request failed' },
    );
  }
});
