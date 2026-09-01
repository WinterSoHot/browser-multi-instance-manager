const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { registerIpcHandlers } = require('../lib/ipc-handlers');

const privatePath = path.resolve(path.sep, 'private', 'path');
const releaseUrl = 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0';

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
  'export-selected-profiles',
  'preview-import',
  'execute-import',
  'get-browser-settings',
  'set-browser-settings',
  'get-default-browser-path',
  'get-platform',
  'get-browser-environment',
  'browse-folder',
  'get-app-settings',
  'set-app-settings',
  'get-app-version',
  'check-for-updates',
  'open-release-page',
  'get-workspaces',
  'create-workspace',
  'rename-workspace',
  'delete-workspace',
  'assign-profile-workspace',
  'assign-profiles-workspace',
  'set-profile-favorite',
  'set-profiles-favorite',
  'inspect-profile-diagnostics',
  'repair-profile-directory',
];

function createHandlerFixture({
  profileService: profileOverrides = {},
  browserProcessManager: processOverrides = {},
  settingsService: settingsOverrides = {},
  appSettingsService: appSettingsOverrides = {},
  workspaceService: workspaceOverrides = {},
  diagnosticsService: diagnosticsOverrides = {},
  updateChecker: updateCheckerOverrides = {},
  openExternal = async () => {},
  appVersion = '1.3.1',
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
    appSettingsService: {
      get: () => ({ closeToTray: true, checkUpdatesOnStartup: true }),
      set: () => ({ success: true, settings: { closeToTray: true, checkUpdatesOnStartup: true } }),
      ...appSettingsOverrides,
    },
    updateChecker: {
      check: async () => ({ status: 'current' }),
      ...updateCheckerOverrides,
    },
    openExternal,
    appVersion,
    workspaceService: {
      list: () => [],
      create: () => {},
      rename: () => {},
      remove: () => {},
      assign: () => {},
      assignMany: () => {},
      setFavorite: () => {},
      setFavoriteMany: () => {},
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

test('registers each existing IPC channel once and unregisters cleanly', async () => {
  const { handlers, unregister } = createHandlerFixture({
    profileService: {
      list: () => [{ id: 'profile-1' }],
    },
  });

  assert.deepEqual([...handlers.keys()], expectedChannels);
  assert.deepEqual(await handlers.get('get-profiles')({}, undefined), [{ id: 'profile-1' }]);

  unregister();

  assert.equal(handlers.size, 0);
});

test('IPC removes the legacy one-shot import channel', () => {
  const { handlers } = createHandlerFixture();
  assert.equal(handlers.has('import-profiles'), false);
});

test('update IPC accepts only exact force payloads and narrows direct or cached results', async () => {
  const calls = [];
  const { handlers } = createHandlerFixture({
    updateChecker: {
      check(options) {
        calls.push(options);
        return { status: 'cached', result: { status: 'available', version: '1.4.0', releaseUrl } };
      },
    },
    appVersion: '1.3.1',
  });

  assert.equal(await handlers.get('get-app-version')({}), '1.3.1');
  assert.deepEqual(await handlers.get('check-for-updates')({}, { force: true }), {
    status: 'cached', result: { status: 'available', version: '1.4.0', releaseUrl },
  });
  assert.deepEqual(calls, [{ force: true }]);
  for (const payload of [undefined, {}, { force: 'true' }, { force: true, extra: true }]) {
    assert.deepEqual(await handlers.get('check-for-updates')({}, payload), {
      status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED',
    });
  }

  const malformed = createHandlerFixture({
    updateChecker: { check: () => ({ status: 'available', version: '1.4.0', releaseUrl: 'https://evil.example' }) },
  });
  assert.deepEqual(await malformed.handlers.get('check-for-updates')({}, { force: false }), {
    status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED',
  });
  for (const version of ['1.3.1', '1.2.9']) {
    const stale = createHandlerFixture({
      updateChecker: { check: () => ({
        status: 'available',
        version,
        releaseUrl: `https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v${version}`,
      }) },
    });
    assert.deepEqual(await stale.handlers.get('check-for-updates')({}, { force: false }), {
      status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED',
    });
  }
});

test('release page IPC revalidates the URL and never leaks shell failures', async () => {
  const opened = [];
  const { handlers } = createHandlerFixture({
    openExternal: async (url) => { opened.push(url); },
  });

  assert.deepEqual(await handlers.get('open-release-page')({}, releaseUrl), { success: true });
  assert.deepEqual(opened, [releaseUrl]);
  assert.deepEqual(await handlers.get('open-release-page')({}, 'https://evil.example'), {
    success: false, code: 'INVALID_RELEASE_URL',
  });
  const failing = createHandlerFixture({ openExternal: async () => { throw new Error(privatePath); } });
  assert.deepEqual(await failing.handlers.get('open-release-page')({}, releaseUrl), {
    success: false, code: 'OPEN_RELEASE_PAGE_FAILED',
  });
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
  assert.deepEqual(
    await handlers.get('inspect-profile-diagnostics')({}, ''),
    { code: 'DIAGNOSTICS_UNAVAILABLE', state: 'process-unknown', actions: ['retry'] },
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

test('IPC sanitizes unexpected profile, process, workspace, and settings failures', async () => {
  const secrets = ['/Users/secret/profile', 'C:\\Users\\secret\\browser.exe'];
  const { handlers } = createHandlerFixture({
    profileService: {
      list: () => { throw new Error(secrets[0]); },
      add: () => Promise.reject(secrets[1]),
    },
    browserProcessManager: {
      close: () => ({ success: false, error: secrets[0], pid: 991 }),
      getStatuses: () => Promise.reject({ command: secrets[1] }),
    },
    workspaceService: {
      list: () => { throw secrets[1]; },
    },
    settingsService: {
      set: () => ({ success: false, error: secrets[0] }),
      getEnvironment: () => Promise.reject(null),
    },
  });

  const results = [
    await handlers.get('get-profiles')(),
    await handlers.get('add-profile')({}, { browserType: 'chrome', profileName: 'Work' }),
    await handlers.get('close-browser')({}, 'profile-1'),
    await handlers.get('get-browser-statuses')({}, ['profile-1']),
    await handlers.get('get-workspaces')(),
    await handlers.get('set-browser-settings')({}, {}),
    await handlers.get('get-browser-environment')(),
  ];

  assert.deepEqual(results, [
    [],
    { success: false, code: 'PROFILE_REQUEST_FAILED', error: 'Profile request failed' },
    { success: false, code: 'PROCESS_REQUEST_FAILED', error: 'Process request failed' },
    { 'profile-1': { running: false, verificationUnavailable: true } },
    [],
    { success: false, code: 'SETTINGS_REQUEST_FAILED', error: 'Settings request failed' },
    { platform: 'unknown', settings: {}, defaultPaths: {}, validity: {} },
  ]);
  const serialized = JSON.stringify(results);
  secrets.forEach((secret) => assert.equal(serialized.includes(secret), false));
  assert.equal(serialized.includes('991'), false);
});

test('IPC strips PID and command fields even from otherwise known process failures', async () => {
  const { handlers } = createHandlerFixture({
    browserProcessManager: {
      close: () => ({
        success: false,
        error: 'Browser not running',
        pid: 991,
        command: 'C:\\Users\\secret\\browser.exe --profile secret',
      }),
    },
  });

  assert.deepEqual(await handlers.get('close-browser')({}, 'profile-1'), {
    success: false,
    code: 'BROWSER_NOT_RUNNING',
    error: 'Browser not running',
  });
});

test('IPC does not trust error text paired with a known code or process success extras', async () => {
  const secretPath = 'C:\\Users\\secret\\browser.exe';
  const { handlers } = createHandlerFixture({
    profileService: {
      add: () => ({
        success: false,
        code: 'PROFILE_ADD_FAILED',
        error: secretPath,
      }),
    },
    browserProcessManager: {
      close: () => ({
        success: true,
        pid: 991,
        command: `${secretPath} --profile secret`,
      }),
    },
  });

  assert.deepEqual(await handlers.get('add-profile')({}, {}), {
    success: false,
    code: 'PROFILE_ADD_FAILED',
    error: 'Unable to add profile',
  });
  assert.deepEqual(await handlers.get('close-browser')({}, 'profile-1'), {
    success: true,
  });
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
    { 'profile-3': { running: false, verificationUnavailable: true } },
  );
  assert.deepEqual(
    await handlers.get('get-browser-statuses')({}, ['profile-4'], { force: 'true' }),
    { 'profile-4': { running: false, verificationUnavailable: true } },
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

test('app settings IPC exposes only validated settings and sanitizes failures', async () => {
  let patch;
  const { handlers } = createHandlerFixture({
    appSettingsService: {
      get: () => ({ closeToTray: false, path: privatePath }),
      set(value) {
        patch = value;
        return { success: true, settings: { closeToTray: false, checkUpdatesOnStartup: true } };
      },
    },
  });

  assert.deepEqual(await handlers.get('get-app-settings')({}, undefined), {
    closeToTray: true,
    checkUpdatesOnStartup: true,
  });
  assert.deepEqual(await handlers.get('set-app-settings')({}, { closeToTray: false }), {
    success: true,
    settings: { closeToTray: false, checkUpdatesOnStartup: true },
  });
  assert.deepEqual(patch, { closeToTray: false });

  const failure = createHandlerFixture({
    appSettingsService: { set: () => Promise.reject(new Error(privatePath)) },
  });
  assert.deepEqual(await failure.handlers.get('set-app-settings')({}, { closeToTray: false }), {
    success: false,
    code: 'APP_SETTINGS_REQUEST_FAILED',
    error: 'Unable to save app settings',
  });
});

test('app settings IPC rejects a malformed success response instead of reporting success', async () => {
  const { handlers } = createHandlerFixture({
    appSettingsService: {
      set: () => ({ success: true, settings: { closeToTray: 'bad' } }),
    },
  });

  assert.deepEqual(await handlers.get('set-app-settings')({}, { closeToTray: false }), {
    success: false,
    code: 'APP_SETTINGS_REQUEST_FAILED',
    error: 'Unable to save app settings',
  });
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

test('batch organization IPC validates exact payloads and delegates deduplicated IDs', async () => {
  const calls = [];
  const { handlers } = createHandlerFixture({
    workspaceService: {
      assignMany: (payload) => {
        calls.push({ method: 'assignMany', payload });
        return { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] };
      },
      setFavoriteMany: (payload) => {
        calls.push({ method: 'setFavoriteMany', payload });
        return { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] };
      },
    },
    profileService: {
      exportMetadata: (profileIds) => {
        calls.push({ method: 'exportMetadata', payload: profileIds });
        return { success: true, count: 1, skippedCount: 0 };
      },
    },
  });

  assert.deepEqual(await handlers.get('assign-profiles-workspace')({}, {
    profileIds: ['p1', 'p1'],
    workspaceId: null,
  }), { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] });
  assert.deepEqual(await handlers.get('set-profiles-favorite')({}, {
    profileIds: ['p1'],
    favorite: true,
  }), { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] });
  assert.deepEqual(await handlers.get('export-selected-profiles')({}, {
    profileIds: ['p1'],
  }), { success: true, count: 1, skippedCount: 0 });
  assert.deepEqual(calls, [
    { method: 'assignMany', payload: { profileIds: ['p1'], workspaceId: null } },
    { method: 'setFavoriteMany', payload: { profileIds: ['p1'], favorite: true } },
    { method: 'exportMetadata', payload: ['p1'] },
  ]);
});

test('batch organization IPC rejects extra keys and sanitizes dependency failures', async () => {
  const secret = '/Users/private/profile';
  const { handlers } = createHandlerFixture({
    workspaceService: {
      assignMany: async () => { throw new Error(secret); },
    },
  });
  assert.deepEqual(await handlers.get('assign-profiles-workspace')({}, {
    profileIds: ['p1'],
    workspaceId: null,
    extra: true,
  }), { success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' });
  const failed = await handlers.get('assign-profiles-workspace')({}, {
    profileIds: ['p1'],
    workspaceId: null,
  });
  assert.deepEqual(failed, { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' });
  assert.equal(JSON.stringify(failed).includes(secret), false);
});

test('batch organization IPC rejects non-exact records without executing accessors or proxies', async () => {
  let getterReads = 0;
  const accessorPayload = {};
  Object.defineProperties(accessorPayload, {
    profileIds: {
      enumerable: true,
      get() {
        getterReads += 1;
        return ['p1'];
      },
    },
    workspaceId: { enumerable: true, value: null },
  });
  let proxyTraps = 0;
  const proxyPayload = new Proxy({ profileIds: ['p1'], workspaceId: null }, {
    get() { proxyTraps += 1; },
    getOwnPropertyDescriptor() { proxyTraps += 1; },
    getPrototypeOf() { proxyTraps += 1; },
    ownKeys() { proxyTraps += 1; },
  });
  const inheritedPayload = Object.assign(Object.create({ extra: true }), {
    profileIds: ['p1'],
    workspaceId: null,
  });
  const symbolPayload = { profileIds: ['p1'], workspaceId: null };
  symbolPayload[Symbol('extra')] = true;
  const { handlers } = createHandlerFixture();

  for (const payload of [accessorPayload, inheritedPayload, symbolPayload]) {
    assert.deepEqual(await handlers.get('assign-profiles-workspace')({}, payload), {
      success: false,
      code: 'BATCH_PROFILE_REQUEST_INVALID',
    });
  }
  assert.deepEqual(await handlers.get('assign-profiles-workspace')({}, proxyPayload), {
    success: false,
    code: 'BATCH_PROFILE_REQUEST_INVALID',
  });
  assert.equal(getterReads, 0);
  assert.equal(proxyTraps, 0);
});

test('batch mutation IPC accepts only complete mutually exclusive requested-ID buckets', async () => {
  const results = [
    { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] },
    { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: ['p1'] },
    { success: true, updatedIds: ['p1', 'p1'], unchangedIds: [], skippedIds: [] },
    { success: true, updatedIds: ['p1', 'p3'], unchangedIds: [], skippedIds: [] },
    { success: true, updatedIds: ['p1'], unchangedIds: null, skippedIds: ['p2'] },
  ];
  const { handlers } = createHandlerFixture({
    workspaceService: {
      assignMany: () => results.shift(),
    },
  });

  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(await handlers.get('assign-profiles-workspace')({}, {
      profileIds: ['p1', 'p2'],
      workspaceId: null,
    }), { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' });
  }
});

test('batch mutation and selected export IPC expose only stable failure results', async () => {
  const workspaceMissing = createHandlerFixture({
    workspaceService: {
      assignMany: () => ({ success: false, error: 'Workspace not found', path: privatePath }),
    },
  });
  assert.deepEqual(await workspaceMissing.handlers.get('assign-profiles-workspace')({}, {
    profileIds: ['p1'],
    workspaceId: 'missing',
  }), { success: false, code: 'WORKSPACE_NOT_FOUND' });

  const exportResults = [
    { success: false, canceled: true, path: privatePath },
    { success: false, code: 'PROFILE_EXPORT_EMPTY_SELECTION', path: privatePath },
    { success: true, count: 0, skippedCount: 0, path: privatePath },
    { success: false, error: privatePath },
  ];
  const selectedExport = createHandlerFixture({
    profileService: { exportMetadata: () => exportResults.shift() },
  });
  const expected = [
    { success: false, canceled: true },
    { success: false, code: 'PROFILE_EXPORT_EMPTY_SELECTION' },
    { success: false, code: 'PROFILE_EXPORT_FAILED' },
    { success: false, code: 'PROFILE_EXPORT_FAILED' },
  ];
  for (const result of expected) {
    assert.deepEqual(await selectedExport.handlers.get('export-selected-profiles')({}, {
      profileIds: ['p1'],
    }), result);
  }
});

test('batch mutation IPC does not let dependency results impersonate parse failures', async () => {
  const { handlers } = createHandlerFixture({
    workspaceService: {
      assignMany: () => ({ success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' }),
    },
  });

  assert.deepEqual(await handlers.get('assign-profiles-workspace')({}, {
    profileIds: ['p1'],
    workspaceId: null,
  }), { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' });
});

test('selected export IPC does not let dependency results impersonate parse failures', async () => {
  const { handlers } = createHandlerFixture({
    profileService: {
      exportMetadata: () => ({ success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' }),
    },
  });

  assert.deepEqual(await handlers.get('export-selected-profiles')({}, {
    profileIds: ['p1'],
  }), { success: false, code: 'PROFILE_EXPORT_FAILED' });
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
