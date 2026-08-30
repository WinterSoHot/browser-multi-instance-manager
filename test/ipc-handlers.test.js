const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { registerIpcHandlers } = require('../lib/ipc-handlers');

const privatePath = path.resolve(path.sep, 'private', 'path');

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
  'preview-import',
  'execute-import',
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
  'inspect-profile-diagnostics',
  'repair-profile-directory',
];

function createHandlerFixture({
  profileService: profileOverrides = {},
  browserProcessManager: processOverrides = {},
  settingsService: settingsOverrides = {},
  workspaceService: workspaceOverrides = {},
  diagnosticsService: diagnosticsOverrides = {},
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
      previewImportMetadata: () => {},
      executeImport: () => {},
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
    diagnosticsService: {
      inspect: () => {},
      repairMissingDirectory: () => {},
      ...diagnosticsOverrides,
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

test('IPC removes the legacy one-shot import channel', () => {
  const { handlers } = createHandlerFixture();
  assert.equal(handlers.has('import-profiles'), false);
});

test('diagnostics IPC accepts only a profile ID and never forwards service exceptions', async () => {
  const calls = [];
  const { handlers } = createHandlerFixture({
    diagnosticsService: {
      inspect(profileId) {
        calls.push({ method: 'inspect', profileId });
        return { code: 'HEALTHY', state: 'healthy', actions: [] };
      },
      repairMissingDirectory(profileId) {
        calls.push({ method: 'repair', profileId });
        return { success: true, code: 'DIRECTORY_RECREATED' };
      },
    },
  });

  assert.deepEqual(
    await handlers.get('inspect-profile-diagnostics')({}, 'profile-1'),
    { code: 'HEALTHY', state: 'healthy', actions: [] },
  );
  assert.deepEqual(
    await handlers.get('repair-profile-directory')({}, 'profile-1'),
    { success: true, code: 'DIRECTORY_RECREATED' },
  );
  assert.deepEqual(calls, [
    { method: 'inspect', profileId: 'profile-1' },
    { method: 'repair', profileId: 'profile-1' },
  ]);
  assert.throws(
    () => handlers.get('inspect-profile-diagnostics')({}, ''),
    /Invalid profile ID/,
  );

  const failures = createHandlerFixture({
    diagnosticsService: { inspect: async () => { throw new Error(privatePath); } },
  });
  assert.deepEqual(
    await failures.handlers.get('inspect-profile-diagnostics')({}, 'profile-1'),
    { code: 'DIAGNOSTICS_UNAVAILABLE', state: 'process-unknown', actions: ['retry'] },
  );

  const repairFailure = createHandlerFixture({
    diagnosticsService: { repairMissingDirectory: () => Promise.reject(privatePath) },
  });
  assert.deepEqual(
    await repairFailure.handlers.get('repair-profile-directory')({}, 'profile-1'),
    { success: false, code: 'DIAGNOSTICS_UNAVAILABLE' },
  );
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
  const settings = { chrome: path.resolve(path.sep, 'Applications', 'Google Chrome.app') };
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
  for (const rejection of [null, undefined, 'raw system failure', { message: privatePath }]) {
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

test('import IPC accepts only an opaque token and duplicate-row skip or rename decisions', async () => {
  const calls = [];
  const { handlers } = createHandlerFixture({
    profileService: {
      previewImportMetadata: () => ({ code: 'OK', token: 'a'.repeat(64) }),
      executeImport(payload) {
        calls.push(payload);
        return { success: true, code: 'OK' };
      },
    },
  });

  assert.deepEqual(await handlers.get('preview-import')({}, undefined), {
    code: 'OK', token: 'a'.repeat(64),
  });
  assert.deepEqual(await handlers.get('execute-import')({}, {
    token: 'a'.repeat(64),
    decisions: [{ line: 2, action: 'rename' }],
  }), { success: true, code: 'OK' });
  assert.deepEqual(calls, [{
    token: 'a'.repeat(64),
    decisions: [{ line: 2, action: 'rename' }],
  }]);
  assert.deepEqual(await handlers.get('execute-import')({}, {
    token: 'a'.repeat(64),
    decisions: [{ line: 2, action: 'rename', path: path.resolve(path.sep, 'private') }],
  }), { success: false, code: 'IMPORT_REQUEST_INVALID' });
});

test('import IPC never forwards a service exception or raw system detail', async () => {
  const { handlers } = createHandlerFixture({
    profileService: {
      previewImportMetadata: async () => {
        throw new Error(path.resolve(path.sep, 'private', 'imports', 'profiles.json'));
      },
      executeImport: async () => { throw new Error('native failure'); },
    },
  });

  assert.deepEqual(await handlers.get('preview-import')({}, undefined), {
    success: false,
    code: 'IMPORT_PREVIEW_FAILED',
  });
  assert.deepEqual(await handlers.get('execute-import')({}, {
    token: 'a'.repeat(64),
    decisions: [],
  }), { success: false, code: 'IMPORT_REQUEST_INVALID' });
});
