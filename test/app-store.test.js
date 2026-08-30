const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CURRENT_SCHEMA_VERSION,
  createAppStore,
  migrateStoreData,
  validateAppSettings,
  validateAppSettingsPatch,
  validateUpdateCheckCache,
} = require('../lib/app-store');

const legacyProfile = {
  id: 'work-profile',
  browserType: 'chrome',
  name: 'Work',
  path: '/profiles/chrome/work',
  createdAt: '2026-08-30T00:00:00.000Z',
};

const legacyData = {
  profiles: [legacyProfile],
  browserSettings: { chrome: '/Applications/Google Chrome.app' },
  runningBrowserProcesses: [{
    profileId: 'work-profile',
    browserType: 'chrome',
    profilePath: '/profiles/chrome/work',
    executablePath: '/Applications/Google Chrome.app',
    pid: 1234,
  }],
};

function createStore(snapshot) {
  const writes = [];
  let snapshotReads = 0;
  let data = structuredClone(snapshot);
  return {
    get store() {
      snapshotReads += 1;
      return structuredClone(data);
    },
    set store(value) {
      writes.push(structuredClone(value));
      data = structuredClone(value);
    },
    getSnapshotReads() {
      return snapshotReads;
    },
    getWrites() {
      return structuredClone(writes);
    },
    getData() {
      return structuredClone(data);
    },
    get(key, fallback) {
      return key in data ? structuredClone(data[key]) : fallback;
    },
    set(key, value) {
      data[key] = structuredClone(value);
    },
  };
}

test('migrates legacy data without changing profile identity or paths', () => {
  const migrated = migrateStoreData({ profiles: [legacyProfile] });
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(migrated.profiles[0], {
    ...legacyProfile,
    workspaceId: null,
    favorite: false,
    lastLaunchedAt: null,
  });
});

test('migration is idempotent', () => {
  const once = migrateStoreData(legacyData);
  assert.equal(once.updateCheckCache, null);
  assert.deepEqual(migrateStoreData(once), once);
});

test('update-check cache migration preserves only the minimal valid shape', () => {
  const cache = {
    checkedAt: 1_000,
    checkedVersion: '1.3.1',
    result: {
      status: 'available',
      version: '1.4.0',
      releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
    },
  };
  const migrated = migrateStoreData({ updateCheckCache: cache });

  assert.deepEqual(migrated.updateCheckCache, cache);
  assert.deepEqual(validateUpdateCheckCache({
    checkedAt: 2_000,
    checkedVersion: '1.3.1',
    result: { status: 'current' },
  }), {
    checkedAt: 2_000,
    checkedVersion: '1.3.1',
    result: { status: 'current' },
  });
});

test('app settings migrate close-to-tray to a true default and stay idempotent', () => {
  const once = migrateStoreData({ appSettings: {} });

  assert.deepEqual(once.appSettings, { closeToTray: true });
  assert.deepEqual(migrateStoreData(once), once);
});

test('app settings accept booleans and reject unknown keys or wrong types', () => {
  assert.deepEqual(validateAppSettings({ closeToTray: false }), { closeToTray: false });
  assert.throws(() => validateAppSettings({ closeToTray: 'no' }), /Invalid app settings/u);
  assert.throws(() => validateAppSettings({ arbitrary: true }), /Invalid app settings/u);
});

test('app settings partial validation accepts a non-empty known subset only', () => {
  assert.deepEqual(validateAppSettingsPatch({ closeToTray: false }), { closeToTray: false });
  assert.throws(() => validateAppSettingsPatch({}), /Invalid app settings/u);
  assert.throws(() => validateAppSettingsPatch({ unknown: true }), /Invalid app settings/u);
  assert.throws(() => validateAppSettingsPatch({ closeToTray: 'false' }), /Invalid app settings/u);
});

test('adapter writes a changed legacy snapshot once and returns defensive copies', () => {
  const store = createStore(legacyData);
  const appStore = createAppStore(store);

  assert.equal(store.getSnapshotReads(), 1);
  assert.equal(store.getWrites().length, 1);

  const profiles = appStore.getProfiles();
  profiles[0].name = 'Changed outside the adapter';
  assert.equal(appStore.getProfiles()[0].name, 'Work');

  const settings = appStore.getBrowserSettings();
  settings.chrome = '/tmp/not-persisted';
  assert.equal(
    appStore.getBrowserSettings().chrome,
    '/Applications/Google Chrome.app',
  );
});

test('adapter leaves a current snapshot unwritten', () => {
  const migrated = {
    schemaVersion: 1,
    profiles: [{ ...legacyProfile, workspaceId: null, favorite: false, lastLaunchedAt: null }],
    workspaces: [],
    browserSettings: {},
    runningBrowserProcesses: [],
    appSettings: { closeToTray: true },
    updateCheckCache: null,
  };
  const store = createStore(migrated);

  createAppStore(store);

  assert.equal(store.getSnapshotReads(), 1);
  assert.deepEqual(store.getWrites(), []);
});

test('adapter rejects malformed present collections and settings without writing', () => {
  const invalidSnapshots = [
    { ...legacyData, profiles: { corrupted: true } },
    { ...legacyData, workspaces: { corrupted: true } },
    { ...legacyData, runningBrowserProcesses: { corrupted: true } },
    { ...legacyData, browserSettings: [] },
    { ...legacyData, appSettings: [] },
    { ...legacyData, appSettings: { closeToTray: 'yes' } },
    { ...legacyData, appSettings: { unknown: true } },
    { ...legacyData, updateCheckCache: { checkedAt: -1, checkedVersion: '1.3.1', result: { status: 'current' } } },
    { ...legacyData, updateCheckCache: { checkedAt: 1, checkedVersion: 'v1.3.1', result: { status: 'current' } } },
    { ...legacyData, updateCheckCache: { checkedAt: 1, checkedVersion: '1.3.1', result: { status: 'current', extra: true } } },
    { ...legacyData, updateCheckCache: { checkedAt: 1, checkedVersion: '1.3.1', result: { status: 'available', version: '1.4.0', releaseUrl: 'https://evil.example' } } },
  ];

  for (const snapshot of invalidSnapshots) {
    const store = createStore(snapshot);

    assert.throws(() => createAppStore(store), /Invalid app store data/);
    assert.deepEqual(store.getWrites(), []);
  }
});

test('adapter rejects malformed nested records without writing', () => {
  const validWorkspace = {
    id: 'workspace-1',
    name: 'Work',
    createdAt: '2026-08-30T00:00:00.000Z',
  };
  const invalidSnapshots = [
    { ...legacyData, profiles: [{ ...legacyProfile, path: null }] },
    { ...legacyData, workspaces: [{ ...validWorkspace, name: null }] },
    {
      ...legacyData,
      runningBrowserProcesses: [{
        ...legacyData.runningBrowserProcesses[0],
        pid: '1234',
      }],
    },
    { ...legacyData, browserSettings: { chrome: ['/Applications/Google Chrome.app'] } },
  ];

  for (const snapshot of invalidSnapshots) {
    const store = createStore(snapshot);

    assert.throws(() => createAppStore(store), /Invalid app store data/);
    assert.deepEqual(store.getWrites(), []);
  }
});

test('adapter rejects inconsistent workspace collections in legacy and current snapshots without writing', () => {
  const workspace = {
    id: 'workspace-1',
    name: 'Café',
    createdAt: '2026-08-30T00:00:00.000Z',
  };
  const invalidCollections = [
    {
      profiles: [legacyProfile],
      workspaces: [workspace, { ...workspace, name: 'Other' }],
    },
    {
      profiles: [legacyProfile],
      workspaces: [workspace, {
        ...workspace,
        id: 'workspace-2',
        name: 'CAFE\u0301',
      }],
    },
    {
      profiles: [legacyProfile],
      workspaces: [{ ...workspace, name: ' Café' }],
    },
    {
      profiles: [legacyProfile],
      workspaces: [{ ...workspace, name: 'x'.repeat(81) }],
    },
    {
      profiles: [{ ...legacyProfile, workspaceId: 'missing-workspace' }],
      workspaces: [workspace],
    },
    {
      profiles: [legacyProfile, { ...legacyProfile, name: 'Other' }],
      workspaces: [workspace],
    },
  ];

  for (const collections of invalidCollections) {
    for (const schemaVersion of [undefined, CURRENT_SCHEMA_VERSION]) {
      const snapshot = {
        ...(schemaVersion === undefined ? {} : { schemaVersion }),
        ...collections,
        browserSettings: {},
        runningBrowserProcesses: [],
        appSettings: {},
      };
      const store = createStore(snapshot);

      assert.throws(() => createAppStore(store), /Invalid app store data/u);
      assert.deepEqual(store.getWrites(), []);
      assert.deepEqual(store.getData(), snapshot);
    }
  }
});

test('runtime profile and workspace writes validate the complete collection before writing', () => {
  const workspace = {
    id: 'workspace-1',
    name: 'Work',
    createdAt: '2026-08-30T00:00:00.000Z',
  };
  const current = migrateStoreData({
    profiles: [{ ...legacyProfile, workspaceId: 'workspace-1' }],
    workspaces: [workspace],
  });
  const store = createStore(current);
  const appStore = createAppStore(store);

  assert.throws(
    () => appStore.setWorkspaces([]),
    /Invalid app store data/u,
  );
  assert.throws(
    () => appStore.setProfiles([{ ...current.profiles[0], workspaceId: 'missing' }]),
    /Invalid app store data/u,
  );
  assert.throws(
    () => appStore.setProfilesAndWorkspaces(current.profiles, [
      workspace,
      { ...workspace, id: 'workspace-2', name: 'work' },
    ]),
    /Invalid app store data/u,
  );
  assert.deepEqual(store.getData(), current);
  assert.deepEqual(store.getWrites(), []);
});

test('runtime app settings writes validate before persisting', () => {
  const current = migrateStoreData(legacyData);
  const store = createStore(current);
  const appStore = createAppStore(store);

  appStore.setAppSettings({ closeToTray: false });
  assert.deepEqual(appStore.getAppSettings(), { closeToTray: false });
  assert.throws(() => appStore.setAppSettings({ closeToTray: 'false' }), /Invalid app settings/u);
  assert.throws(() => appStore.setAppSettings({ closeToTray: true, extra: true }), /Invalid app settings/u);
  assert.deepEqual(store.getData().appSettings, { closeToTray: false });
});

test('runtime update-check cache writes validate and return defensive copies', () => {
  const store = createStore(migrateStoreData(legacyData));
  const appStore = createAppStore(store);
  const cache = {
    checkedAt: 1_000,
    checkedVersion: '1.3.1',
    result: {
      status: 'available',
      version: '1.4.0',
      releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
    },
  };

  appStore.setUpdateCheckCache(cache);
  cache.result.version = '9.9.9';
  assert.equal(appStore.getUpdateCheckCache().result.version, '1.4.0');
  const returned = appStore.getUpdateCheckCache();
  returned.result.status = 'current';
  assert.equal(appStore.getUpdateCheckCache().result.status, 'available');
  const hiddenCache = appStore.getUpdateCheckCache();
  Object.defineProperty(hiddenCache.result, 'hidden', { value: true });
  const symbolCache = appStore.getUpdateCheckCache();
  symbolCache.result[Symbol('hidden')] = true;

  for (const invalidCache of [
    { ...appStore.getUpdateCheckCache(), extra: true },
    { ...appStore.getUpdateCheckCache(), result: { status: 'current', extra: true } },
    { ...appStore.getUpdateCheckCache(), result: { status: 'available', version: '1.4.0', releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0', extra: true } },
    hiddenCache,
    symbolCache,
  ]) {
    assert.throws(() => appStore.setUpdateCheckCache(invalidCache), /Invalid update check cache/u);
  }
  assert.equal(appStore.getUpdateCheckCache().result.status, 'available');
});

test('adapter rejects unsupported future schema versions without writing', () => {
  const store = createStore({
    ...migrateStoreData(legacyData),
    schemaVersion: CURRENT_SCHEMA_VERSION + 1,
  });

  assert.throws(
    () => createAppStore(store),
    /Unsupported app store schema version/,
  );
  assert.deepEqual(store.getWrites(), []);
});

test('adapter writes profile and workspace metadata in one snapshot', () => {
  const currentData = migrateStoreData(legacyData);
  const store = createStore(currentData);
  const appStore = createAppStore(store);
  const profiles = [{
    ...currentData.profiles[0],
    workspaceId: 'workspace-1',
    favorite: true,
  }];
  const workspaces = [{
    id: 'workspace-1',
    name: 'Work',
    createdAt: '2026-08-30T00:00:00.000Z',
  }];

  appStore.setProfilesAndWorkspaces(profiles, workspaces);

  assert.deepEqual(store.getWrites(), [{
    ...currentData,
    profiles,
    workspaces,
  }]);
});
