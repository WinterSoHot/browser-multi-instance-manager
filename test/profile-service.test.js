const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

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
        return { success: true, pid: 42 };
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

test('export and import keep only profile metadata and skip duplicate names', async () => {
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

  const imported = await fixture.service.importMetadata();
  assert.equal(imported.success, true);
  assert.equal(imported.skipped, 1);
  assert.equal(imported.profiles.length, 1);
  assert.deepEqual(imported.profiles[0].browserType, 'firefox');
  assert.deepEqual(imported.profiles[0].name, 'Personal');
  assert.deepEqual(fixture.storeState().profiles.map(({ browserType, name }) => ({ browserType, name })), [
    { browserType: 'chrome', name: 'Work' },
    { browserType: 'firefox', name: 'Personal' },
  ]);
});
