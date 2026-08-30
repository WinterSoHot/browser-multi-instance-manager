const test = require('node:test');
const assert = require('node:assert/strict');

let appStoreModule = {};
try {
  appStoreModule = require('../lib/app-store');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

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
  runningBrowserProcesses: [{ profileId: 'work-profile', pid: 1234 }],
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
  const migrated = appStoreModule.migrateStoreData?.({ profiles: [legacyProfile] });
  assert.equal(migrated?.schemaVersion, appStoreModule.CURRENT_SCHEMA_VERSION);
  assert.deepEqual(migrated?.profiles[0], {
    ...legacyProfile,
    workspaceId: null,
    favorite: false,
    lastLaunchedAt: null,
  });
});

test('migration is idempotent', () => {
  const once = appStoreModule.migrateStoreData?.(legacyData);
  assert.deepEqual(appStoreModule.migrateStoreData?.(once), once);
});

test('adapter writes a changed legacy snapshot once and returns defensive copies', () => {
  const store = createStore(legacyData);
  const appStore = appStoreModule.createAppStore?.(store);

  assert.equal(store.getSnapshotReads(), 1);
  assert.equal(store.getWrites().length, 1);

  const profiles = appStore?.getProfiles();
  profiles[0].name = 'Changed outside the adapter';
  assert.equal(appStore?.getProfiles()[0].name, 'Work');

  const settings = appStore?.getBrowserSettings();
  settings.chrome = '/tmp/not-persisted';
  assert.equal(
    appStore?.getBrowserSettings().chrome,
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

  appStoreModule.createAppStore?.(store);

  assert.equal(store.getSnapshotReads(), 1);
  assert.deepEqual(store.getWrites(), []);
});
