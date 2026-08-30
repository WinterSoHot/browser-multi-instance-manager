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

function createServiceFixture({
  profiles = [],
  browserStatus = { running: false },
  executablePath = '/Applications/Google Chrome.app',
  existingPaths = [],
  importDocument = null,
  saveDialogResult = { canceled: false, filePath: '/exports/profiles.json' },
  openDialogResult = { canceled: false, filePaths: ['/imports/profiles.json'] },
  launchResult = { success: true, pid: 42 },
  now = () => new Date().toISOString(),
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
    getProfilesDir: () => '/profiles',
    createProfileDir: async (browserType, profileName) => {
      const profilePath = path.join('/profiles', browserType, profileName);
      createdDirectories.push(profilePath);
      existing.add(profilePath);
      return profilePath;
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
  assert.deepEqual(fixture.createdDirectories, ['/profiles/chrome/Work']);
});

test('remove refuses a running profile before trashing data', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: '/profiles/chrome/Work',
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
    path: '/profiles/chrome/Work',
  };
  const fixture = createServiceFixture({
    profiles: [profile],
    existingPaths: [profile.path],
  });

  const renamed = await fixture.service.rename({ profileId: 'p1', newName: 'Personal' });
  assert.deepEqual(renamed, {
    success: true,
    profile: { ...profile, name: 'Personal', path: '/profiles/chrome/Personal' },
  });
  assert.deepEqual(fixture.renamedDirectories, [{
    oldPath: '/profiles/chrome/Work',
    newPath: '/profiles/chrome/Personal',
  }]);

  const clone = await fixture.service.cloneBlank('p1');
  assert.equal(clone.success, true);
  assert.equal(clone.profile.name, 'Personal 副本');
  assert.equal(clone.profile.path, '/profiles/chrome/Personal 副本');
  assert.deepEqual(await fixture.service.size('p1'), { success: true, bytes: 2048 });
  assert.deepEqual(await fixture.service.openFolder('p1'), { success: true });
  assert.deepEqual(fixture.openPathCalls, ['/profiles/chrome/Personal']);
});

test('launch validates the stored path and delegates only valid profile launches', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: '/profiles/chrome/Work',
  };
  const fixture = createServiceFixture({
    profiles: [profile],
    existingPaths: [profile.path, '/Applications/Google Chrome.app'],
  });

  assert.deepEqual(await fixture.service.launch('p1'), { success: true, pid: 42 });
  assert.deepEqual(fixture.launches, [{
    profileId: 'p1',
    browserType: 'chrome',
    profilePath: '/profiles/chrome/Work',
    executablePath: '/Applications/Google Chrome.app',
  }]);
});

test('only a successful launch records the current last-launched timestamp', async () => {
  const profile = {
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: '/profiles/chrome/Work',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLaunchedAt: null,
  };
  const fixture = createServiceFixture({
    profiles: [profile],
    existingPaths: [profile.path, '/Applications/Google Chrome.app'],
    now: () => '2026-01-02T03:04:05.000Z',
  });

  assert.deepEqual(await fixture.service.launch('p1'), { success: true, pid: 42 });
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
    path: '/profiles/chrome/Work',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLaunchedAt: '2026-01-01T12:00:00.000Z',
  };
  for (const launchResult of [
    { success: false, error: 'Failed to launch browser' },
    { success: false, error: 'Browser is already running' },
  ]) {
    const fixture = createServiceFixture({
      profiles: [profile],
      existingPaths: [profile.path, '/Applications/Google Chrome.app'],
      launchResult,
      now: () => '2026-01-02T03:04:05.000Z',
    });

    assert.deepEqual(await fixture.service.launch('p1'), launchResult);
    assert.equal(fixture.storeState().profiles[0].lastLaunchedAt, profile.lastLaunchedAt);
  }
});

test('markLaunched replaces only the targeted profile metadata', async () => {
  const profiles = [
    {
      id: 'p1',
      browserType: 'chrome',
      name: 'Work',
      path: '/profiles/chrome/Work',
      lastLaunchedAt: null,
    },
    {
      id: 'p2',
      browserType: 'firefox',
      name: 'Personal',
      path: '/profiles/firefox/Personal',
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
    path: '/profiles/chrome/Work',
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
    getBrowserExecutable: () => '/Applications/Google Chrome.app',
    getProfilesDir: () => '/profiles',
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
      path: '/profiles/firefox/Personal',
      lastLaunchedAt: null,
    });
    profiles = staleProfiles;
  });
  await globalMutationStarted;

  const launched = service.launch('p1');
  await new Promise((resolve) => setImmediate(resolve));
  releaseGlobalMutation();

  assert.deepEqual(await launched, { success: true, pid: 42 });
  await pendingGlobalMutation;
  assert.deepEqual(profiles.map((profile) => profile.id), ['p1', 'p2']);
  assert.equal(profiles[0].lastLaunchedAt, '2026-01-02T03:04:05.000Z');
});

test('markLaunched uses the global mutation queue instead of waiting for lifecycle work', async () => {
  let profiles = [{
    id: 'p1',
    browserType: 'chrome',
    name: 'Work',
    path: '/profiles/chrome/Work',
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
    path: '/profiles/chrome/Work',
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
    filePath: '/exports/profiles.json',
    content: '{\n  "version": 1,\n  "profiles": [\n    {\n      "browserType": "chrome",\n      "name": "Work"\n    }\n  ]\n}\n',
  }]);

  assert.equal(fixture.service.importMetadata, undefined);
});

test('previewImportMetadata owns the file dialog and bounded reader without exposing the selected path', async () => {
  const calls = [];
  const service = createProfileService({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/imports/profiles.json'] }),
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
    { method: 'read', filePath: '/private/imports/profiles.json' },
    {
      method: 'preview',
      document: { version: 1, profiles: [{ browserType: 'chrome', name: 'Work' }] },
    },
  ]);
});

test('previewImportMetadata returns a stable code for malformed documents and read failures', async () => {
  for (const readImportFile of [async () => '{', async () => { throw new Error('/private/failure'); }]) {
    const service = createProfileService({
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/imports/profiles.json'] }),
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
