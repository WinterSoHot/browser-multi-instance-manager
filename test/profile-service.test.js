const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createProfileOperationCoordinator } = require('../lib/profile-operation-coordinator');

let createProfileService;
try {
  ({ createProfileService } = require('../lib/profile-service'));
} catch {
  // The first TDD run intentionally exercises the missing service.
}

const fixtureRoot = path.resolve('test-fixtures');
const profilesRoot = path.join(fixtureRoot, 'profiles');
const chromeExecutable = path.join(fixtureRoot, 'browsers', 'chrome');
const exportFilePath = path.join(fixtureRoot, 'exports', 'profiles.json');
const importFilePath = path.join(fixtureRoot, 'imports', 'profiles.json');
const profilePath = (browserType, profileName) => (
  path.join(profilesRoot, browserType, profileName)
);

function createServiceFixture({
  profiles = [],
  browserStatus = { running: false },
  executablePath = chromeExecutable,
  existingPaths = [],
  importDocument = null,
  saveDialogResult = { canceled: false, filePath: exportFilePath },
  openDialogResult = { canceled: false, filePaths: [importFilePath] },
  launchResult = { success: true, pid: 42 },
  now = () => new Date().toISOString(),
  serviceOverrides = {},
} = {}) {
  let storeState = { profiles: structuredClone(profiles) };
  const createdDirectories = [];
  const renamedDirectories = [];
  const trashCalls = [];
  const openPathCalls = [];
  const launches = [];
  const exportedFiles = [];
  const existing = new Set(existingPaths);
  const profileOperations = {
    runGlobalMutation: (operation) => operation(),
    runMutation: (profileId, operation) => operation(),
    runLifecycle: (profileId, operation) => operation(),
  };
  const service = createProfileService({
    appStore: {
      getProfiles: () => structuredClone(storeState.profiles),
      setProfiles: (nextProfiles) => {
        storeState.profiles = structuredClone(nextProfiles);
      },
    },
    profileOperations,
    browserProcessManager: {
      getStatus: async () => structuredClone(browserStatus),
      launch: async (options) => {
        launches.push(options);
        return structuredClone(launchResult);
      },
    },
    getBrowserExecutable: () => executablePath,
    getProfilesDir: () => profilesRoot,
    createProfileDir: async (browserType, profileName) => {
      const createdPath = profilePath(browserType, profileName);
      createdDirectories.push(createdPath);
      existing.add(createdPath);
      return createdPath;
    },
    pathExists: async (targetPath) => existing.has(targetPath),
    getDirectorySize: async () => 2048,
    renameDirectory: async (oldPath, newPath) => {
      renamedDirectories.push({ oldPath, newPath });
      existing.delete(oldPath);
      existing.add(newPath);
    },
    trashItem: async (targetPath) => {
      trashCalls.push(targetPath);
      existing.delete(targetPath);
    },
    openPath: async (targetPath) => {
      openPathCalls.push(targetPath);
      return '';
    },
    showSaveDialog: async () => saveDialogResult,
    showOpenDialog: async () => openDialogResult,
    readImportFile: async () => JSON.stringify(importDocument),
    writeExportFile: async (filePath, content) => {
      exportedFiles.push({ filePath, content });
    },
    now,
    ...serviceOverrides,
  });

  return {
    service,
    storeState: () => structuredClone(storeState),
    createdDirectories,
    renamedDirectories,
    trashCalls,
    openPathCalls,
    launches,
    exportedFiles,
  };
}

test('add validates and persists one profile', async () => {
  const fixture = createServiceFixture();

  const result = await fixture.service.add({ browserType: 'chrome', profileName: 'Work' });

  assert.equal(result.success, true);
  assert.equal(result.profile.browserType, 'chrome');
  assert.equal(fixture.storeState().profiles[0].name, 'Work');
  assert.deepEqual(fixture.createdDirectories, [profilePath('chrome', 'Work')]);
});

test('remove refuses a running profile before trashing data', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
  };
  const fixture = createServiceFixture({
    profiles: [profile],
    browserStatus: { running: true },
    existingPaths: [profile.path],
  });

  assert.deepEqual(await fixture.service.remove({ profileId: 'p1', trashData: true }), {
    success: false,
    error: 'Close the browser before removing its profile',
  });
  assert.deepEqual(fixture.trashCalls, []);
  assert.deepEqual(fixture.storeState().profiles, [profile]);
});

test('rename, clone, size, and open folder preserve profile metadata behavior', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
  };
  const fixture = createServiceFixture({
    profiles: [profile],
    existingPaths: [profile.path],
  });

  const renamed = await fixture.service.rename({ profileId: 'p1', newName: 'Personal' });
  assert.deepEqual(renamed, {
    success: true,
    profile: { ...profile, name: 'Personal', path: profilePath('chrome', 'Personal') },
  });
  assert.deepEqual(fixture.renamedDirectories, [{
    oldPath: profilePath('chrome', 'Work'),
    newPath: profilePath('chrome', 'Personal'),
  }]);

  const clone = await fixture.service.cloneBlank('p1');
  assert.equal(clone.success, true);
  assert.equal(clone.profile.name, 'Personal 副本');
  assert.equal(clone.profile.path, profilePath('chrome', 'Personal 副本'));
  assert.deepEqual(await fixture.service.size('p1'), { success: true, bytes: 2048 });
  assert.deepEqual(await fixture.service.openFolder('p1'), { success: true });
  assert.deepEqual(fixture.openPathCalls, [profilePath('chrome', 'Personal')]);
});

test('launch validates the stored path and delegates only valid profile launches', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
  };
  const fixture = createServiceFixture({
    profiles: [profile],
    existingPaths: [profile.path, chromeExecutable],
  });

  assert.deepEqual(await fixture.service.launch('p1'), { success: true });
  assert.deepEqual(fixture.launches, [{
    profileId: 'p1',
    browserType: 'chrome',
    profilePath: profilePath('chrome', 'Work'),
    executablePath: chromeExecutable,
  }]);
});

test('launch reports a stable browser-path error without echoing the configured path', async () => {
  const configuredPath = 'C:\\Users\\secret\\browser.exe';
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
  };
  const fixture = createServiceFixture({ profiles: [profile], executablePath: configuredPath });

  const result = await fixture.service.launch('p1');

  assert.deepEqual(result, {
    success: false,
    code: 'BROWSER_PATH_INVALID',
    error: 'Browser path is invalid',
  });
  assert.equal(JSON.stringify(result).includes(configuredPath), false);
  assert.deepEqual(fixture.launches, []);
});

test('profile operations sanitize unexpected filesystem, dialog, and store failures', async () => {
  const secretValues = ['/Users/secret/profile', 'C:\\Users\\secret\\profile'];
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
  };
  const cases = [
    {
      name: 'add filesystem',
      expected: ['PROFILE_ADD_FAILED', 'Unable to add profile'],
      fixture: { serviceOverrides: { createProfileDir: async () => { throw new Error(secretValues[0]); } } },
      run: (service) => service.add({ browserType: 'chrome', profileName: 'New' }),
    },
    {
      name: 'add store',
      expected: ['PROFILE_ADD_FAILED', 'Unable to add profile'],
      fixture: {
        serviceOverrides: {
          appStore: {
            getProfiles: () => [],
            setProfiles: () => { throw new Error(secretValues[0]); },
          },
        },
      },
      run: (service) => service.add({ browserType: 'chrome', profileName: 'New' }),
    },
    {
      name: 'remove',
      expected: ['PROFILE_REMOVE_FAILED', 'Unable to remove profile'],
      fixture: {
        profiles: [profile],
        existingPaths: [profile.path],
        serviceOverrides: { trashItem: async () => { throw secretValues[1]; } },
      },
      run: (service) => service.remove({ profileId: 'p1', trashData: true }),
    },
    {
      name: 'rename',
      expected: ['PROFILE_RENAME_FAILED', 'Unable to rename profile'],
      fixture: {
        profiles: [profile],
        existingPaths: [profile.path],
        serviceOverrides: { renameDirectory: async () => { throw new Error(secretValues[0]); } },
      },
      run: (service) => service.rename({ profileId: 'p1', newName: 'Renamed' }),
    },
    {
      name: 'clone',
      expected: ['PROFILE_CLONE_FAILED', 'Unable to clone profile'],
      fixture: {
        profiles: [profile],
        serviceOverrides: { createProfileDir: () => Promise.reject(secretValues[1]) },
      },
      run: (service) => service.cloneBlank('p1'),
    },
    {
      name: 'size',
      expected: ['PROFILE_SIZE_FAILED', 'Unable to read profile size'],
      fixture: {
        profiles: [profile],
        existingPaths: [profile.path],
        serviceOverrides: { getDirectorySize: async () => { throw new Error(secretValues[0]); } },
      },
      run: (service) => service.size('p1'),
    },
    {
      name: 'open',
      expected: ['PROFILE_OPEN_FAILED', 'Unable to open profile folder'],
      fixture: {
        profiles: [profile],
        existingPaths: [profile.path],
        serviceOverrides: { openPath: async () => secretValues[1] },
      },
      run: (service) => service.openFolder('p1'),
    },
    {
      name: 'export dialog',
      expected: ['PROFILE_EXPORT_FAILED', 'Unable to export profiles'],
      fixture: { serviceOverrides: { showSaveDialog: () => Promise.reject(secretValues[1]) } },
      run: (service) => service.exportMetadata(),
    },
    {
      name: 'export write',
      expected: ['PROFILE_EXPORT_FAILED', 'Unable to export profiles'],
      fixture: { serviceOverrides: { writeExportFile: async () => { throw new Error(secretValues[0]); } } },
      run: (service) => service.exportMetadata(),
    },
  ];

  for (const entry of cases) {
    const fixture = createServiceFixture(entry.fixture);
    const result = await entry.run(fixture.service);
    assert.deepEqual(result, {
      success: false,
      code: entry.expected[0],
      error: entry.expected[1],
    }, entry.name);
    const serialized = JSON.stringify(result);
    secretValues.forEach((secret) => assert.equal(serialized.includes(secret), false, entry.name));
  }
});

test('only a successful launch records the current last-launched timestamp', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLaunchedAt: null,
  };
  const fixture = createServiceFixture({
    profiles: [profile],
    existingPaths: [profile.path, chromeExecutable],
    now: () => '2026-01-02T03:04:05.000Z',
  });

  assert.deepEqual(await fixture.service.launch('p1'), { success: true });
  assert.equal(
    fixture.storeState().profiles[0].lastLaunchedAt,
    '2026-01-02T03:04:05.000Z',
  );
});

test('failed or already-running launches leave last-launched timestamps unchanged', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLaunchedAt: '2026-01-01T12:00:00.000Z',
  };
  for (const [launchResult, expected] of [
    [
      { success: false, error: 'Failed to launch browser' },
      { success: false, code: 'PROFILE_LAUNCH_FAILED', error: 'Unable to launch browser' },
    ],
    [
      { success: false, error: 'Browser is already running' },
      { success: false, code: 'BROWSER_ALREADY_RUNNING', error: 'Browser already running' },
    ],
  ]) {
    const fixture = createServiceFixture({
      profiles: [profile],
      existingPaths: [profile.path, chromeExecutable],
      launchResult,
      now: () => '2026-01-02T03:04:05.000Z',
    });

    assert.deepEqual(await fixture.service.launch('p1'), expected);
    assert.equal(fixture.storeState().profiles[0].lastLaunchedAt, profile.lastLaunchedAt);
  }
});

test('a metadata write failure preserves launch success with a stable warning', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
    lastLaunchedAt: null,
  };

  for (const profileOperations of [
    {
      runLifecycle: (_profileId, operation) => operation(),
      runGlobalMutation: async (operation) => {
        await operation();
        throw new Error('/Users/secret/store.json');
      },
    },
    {
      runLifecycle: (_profileId, operation) => operation(),
      runGlobalMutation: () => Promise.reject('C:\\Users\\secret\\store.json'),
    },
  ]) {
    const launches = [];
    const service = createProfileService({
      appStore: {
        getProfiles: () => [{ ...profile }],
        setProfiles: () => {},
      },
      profileOperations,
      browserProcessManager: {
        launch: async (options) => {
          launches.push(options);
          return { success: true, pid: 42 };
        },
      },
      getBrowserExecutable: () => chromeExecutable,
      getProfilesDir: () => profilesRoot,
      pathExists: async () => true,
      now: () => '2026-01-02T03:04:05.000Z',
    });

    const result = await service.launch('p1');
    assert.deepEqual(result, {
      success: true,
      warningCode: 'LAST_LAUNCHED_AT_NOT_RECORDED',
    });
    assert.equal(launches.length, 1);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});

test('markLaunched replaces only the targeted profile metadata', async () => {
  const profiles = [
    {
      id: 'p1',
      browserType: 'chrome',
      name: 'Work',
      path: profilePath('chrome', 'Work'),
      lastLaunchedAt: null,
    },
    {
      id: 'p2',
      browserType: 'firefox',
      name: 'Personal',
      path: profilePath('firefox', 'Personal'),
      lastLaunchedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const fixture = createServiceFixture({ profiles });

  assert.deepEqual(
    await fixture.service.markLaunched('p1', '2026-01-02T03:04:05.000Z'),
    {
      success: true,
      profile: { ...profiles[0], lastLaunchedAt: '2026-01-02T03:04:05.000Z' },
    },
  );
  assert.deepEqual(fixture.storeState().profiles, [
    { ...profiles[0], lastLaunchedAt: '2026-01-02T03:04:05.000Z' },
    profiles[1],
  ]);
});

test('successful launch records the timestamp after a concurrent global mutation commits', { timeout: 1000 }, async () => {
  let profiles = [{
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
    lastLaunchedAt: null,
  }];
  const coordinator = createProfileOperationCoordinator();
  let beginGlobalMutation;
  const globalMutationStarted = new Promise((resolve) => {
    beginGlobalMutation = resolve;
  });
  let releaseGlobalMutation;
  const waitForGlobalMutation = new Promise((resolve) => {
    releaseGlobalMutation = resolve;
  });
  const service = createProfileService({
    appStore: {
      getProfiles: () => structuredClone(profiles),
      setProfiles: (nextProfiles) => {
        profiles = structuredClone(nextProfiles);
      },
    },
    profileOperations: coordinator,
    browserProcessManager: {
      launch: async () => ({ success: true, pid: 42 }),
    },
    getBrowserExecutable: () => chromeExecutable,
    getProfilesDir: () => profilesRoot,
    pathExists: async () => true,
    now: () => '2026-01-02T03:04:05.000Z',
  });

  const pendingGlobalMutation = coordinator.runGlobalMutation(async () => {
    const staleProfiles = structuredClone(profiles);
    beginGlobalMutation();
    await waitForGlobalMutation;
    staleProfiles.push({
      id: 'p2',
      browserType: 'firefox',
      name: 'Personal',
      path: profilePath('firefox', 'Personal'),
      lastLaunchedAt: null,
    });
    profiles = staleProfiles;
  });
  await globalMutationStarted;

  const launched = service.launch('p1');
  await new Promise((resolve) => setImmediate(resolve));
  releaseGlobalMutation();

  assert.deepEqual(await launched, { success: true });
  await pendingGlobalMutation;
  assert.deepEqual(profiles.map((profile) => profile.id), ['p1', 'p2']);
  assert.equal(profiles[0].lastLaunchedAt, '2026-01-02T03:04:05.000Z');
});

test('markLaunched uses the global mutation queue instead of waiting for lifecycle work', async () => {
  let profiles = [{
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
    lastLaunchedAt: null,
  }];
  const coordinator = createProfileOperationCoordinator();
  let beginLifecycle;
  const lifecycleStarted = new Promise((resolve) => {
    beginLifecycle = resolve;
  });
  let releaseLifecycle;
  const waitForLifecycle = new Promise((resolve) => {
    releaseLifecycle = resolve;
  });
  const service = createProfileService({
    appStore: {
      getProfiles: () => structuredClone(profiles),
      setProfiles: (nextProfiles) => {
        profiles = structuredClone(nextProfiles);
      },
    },
    profileOperations: coordinator,
  });

  const pendingLifecycle = coordinator.runLifecycle('p1', async () => {
    beginLifecycle();
    await waitForLifecycle;
  });
  await lifecycleStarted;

  const marked = service.markLaunched('p1', '2026-01-02T03:04:05.000Z');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(profiles[0].lastLaunchedAt, '2026-01-02T03:04:05.000Z');

  releaseLifecycle();
  await pendingLifecycle;
  assert.equal((await marked).success, true);
});

test('export keeps only profile metadata and removes the legacy one-shot import entry point', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath('chrome', 'Work'),
  };
  const fixture = createServiceFixture({
    profiles: [profile],
    importDocument: {
      version: 1,
      profiles: [
        { browserType: 'chrome', name: 'work' },
        { browserType: 'firefox', name: 'Personal' },
      ],
    },
  });

  assert.deepEqual(await fixture.service.exportMetadata(), { success: true, count: 1 });
  assert.deepEqual(fixture.exportedFiles, [{
    filePath: exportFilePath,
    content: '{\n  "version": 1,\n  "profiles": [\n    {\n      "browserType": "chrome",\n      "name": "Work"\n    }\n  ]\n}\n',
  }]);

  assert.equal(fixture.service.importMetadata, undefined);
});

test('previewImportMetadata owns the file dialog and bounded reader without exposing the selected path', async () => {
  const calls = [];
  const service = createProfileService({
    showOpenDialog: async () => ({ canceled: false, filePaths: [importFilePath] }),
    readImportFile: async (filePath) => {
      calls.push({ method: 'read', filePath });
      return JSON.stringify({ version: 1, profiles: [{ browserType: 'chrome', name: 'Work' }] });
    },
    importExportService: {
      previewImport(document) {
        calls.push({ method: 'preview', document });
        return { code: 'OK', token: 'a'.repeat(64), valid: [], duplicates: [], invalid: [] };
      },
    },
  });

  assert.deepEqual(await service.previewImportMetadata(), {
    code: 'OK', token: 'a'.repeat(64), valid: [], duplicates: [], invalid: [],
  });
  assert.deepEqual(calls, [
    { method: 'read', filePath: importFilePath },
    {
      method: 'preview',
      document: { version: 1, profiles: [{ browserType: 'chrome', name: 'Work' }] },
    },
  ]);
});

test('previewImportMetadata returns a stable code for malformed documents and read failures', async () => {
  for (const readImportFile of [async () => '{', async () => { throw new Error('/private/failure'); }]) {
    const service = createProfileService({
      showOpenDialog: async () => ({ canceled: false, filePaths: [importFilePath] }),
      readImportFile,
      importExportService: { previewImport: () => assert.fail('invalid JSON must not reach preview') },
    });
    assert.deepEqual(await service.previewImportMetadata(), {
      success: false,
      code: 'INVALID_IMPORT_DOCUMENT',
    });
  }
});

test('previewImportMetadata also sanitizes a failed file dialog', async () => {
  const service = createProfileService({
    showOpenDialog: async () => { throw new Error('/private/dialog-failure'); },
    readImportFile: async () => assert.fail('reader must not run after dialog failure'),
    importExportService: { previewImport: () => assert.fail('preview must not run after dialog failure') },
  });

  assert.deepEqual(await service.previewImportMetadata(), {
    success: false,
    code: 'INVALID_IMPORT_DOCUMENT',
  });
});
