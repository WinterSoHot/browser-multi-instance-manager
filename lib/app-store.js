const { isDeepStrictEqual } = require('node:util');

const CURRENT_SCHEMA_VERSION = 1;

function clone(value) {
  return structuredClone(value);
}

function migrateStoreData(input = {}) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles: Array.isArray(input.profiles) ? input.profiles.map((profile) => ({
      ...profile,
      workspaceId: profile.workspaceId ?? null,
      favorite: profile.favorite === true,
      lastLaunchedAt: profile.lastLaunchedAt ?? null,
    })) : [],
    workspaces: Array.isArray(input.workspaces) ? input.workspaces : [],
    browserSettings: input.browserSettings || {},
    runningBrowserProcesses: Array.isArray(input.runningBrowserProcesses)
      ? input.runningBrowserProcesses : [],
    appSettings: input.appSettings || {},
  };
}

function validateStoreData(data) {
  if (
    !data
    || typeof data !== 'object'
    || data.schemaVersion !== CURRENT_SCHEMA_VERSION
    || !Array.isArray(data.profiles)
    || !Array.isArray(data.workspaces)
    || !data.browserSettings
    || typeof data.browserSettings !== 'object'
    || !Array.isArray(data.runningBrowserProcesses)
    || !data.appSettings
    || typeof data.appSettings !== 'object'
  ) {
    throw new Error('Invalid migrated app store data');
  }
}

function createAppStore(store) {
  const snapshot = store.store;
  const migrated = migrateStoreData(snapshot);
  validateStoreData(migrated);
  if (!isDeepStrictEqual(snapshot, migrated)) {
    store.store = clone(migrated);
  }

  function get(key) {
    return clone(store.get(key));
  }

  function set(key, value) {
    store.set(key, clone(value));
  }

  return {
    getProfiles: () => get('profiles'),
    setProfiles: (profiles) => set('profiles', profiles),
    getBrowserSettings: () => get('browserSettings'),
    setBrowserSettings: (settings) => set('browserSettings', settings),
    getRunningProcesses: () => get('runningBrowserProcesses'),
    setRunningProcesses: (records) => set('runningBrowserProcesses', records),
    getWorkspaces: () => get('workspaces'),
    setWorkspaces: (workspaces) => set('workspaces', workspaces),
    getAppSettings: () => get('appSettings'),
    setAppSettings: (settings) => set('appSettings', settings),
  };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  migrateStoreData,
  createAppStore,
};
