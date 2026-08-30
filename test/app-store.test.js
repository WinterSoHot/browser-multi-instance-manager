const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CURRENT_SCHEMA_VERSION,
  createAppStore,
  migrateStoreData,
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
  assert.deepEqual(migrateStoreData(once), once);
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
    appSettings: {},
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
