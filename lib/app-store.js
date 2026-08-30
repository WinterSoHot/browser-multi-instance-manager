const { isDeepStrictEqual } = require('node:util');

const CURRENT_SCHEMA_VERSION = 1;
const MAX_WORKSPACE_NAME_LENGTH = 80;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value) {
  return value === null || isNonEmptyString(value);
}

function isProfile(profile) {
  return isRecord(profile)
    && isNonEmptyString(profile.id)
    && isNonEmptyString(profile.browserType)
    && isNonEmptyString(profile.name)
    && isNonEmptyString(profile.path)
    && isNonEmptyString(profile.createdAt)
    && (!hasOwn(profile, 'workspaceId') || isOptionalString(profile.workspaceId))
    && (!hasOwn(profile, 'favorite') || typeof profile.favorite === 'boolean')
    && (!hasOwn(profile, 'lastLaunchedAt') || isOptionalString(profile.lastLaunchedAt));
}

function isWorkspace(workspace) {
  return isRecord(workspace)
    && isNonEmptyString(workspace.id)
    && isNonEmptyString(workspace.name)
    && workspace.name === workspace.name.trim()
    && workspace.name.length <= MAX_WORKSPACE_NAME_LENGTH
    && isNonEmptyString(workspace.createdAt);
}

function normalizeWorkspaceName(name) {
  return name.normalize('NFC').toLocaleLowerCase();
}

function validateStoreCollections(profiles, workspaces) {
  if (
    !Array.isArray(profiles)
    || !profiles.every(isProfile)
    || !Array.isArray(workspaces)
    || !workspaces.every(isWorkspace)
  ) {
    throw new Error('Invalid app store data');
  }

  const profileIds = new Set();
  for (const profile of profiles) {
    if (profileIds.has(profile.id)) throw new Error('Invalid app store data');
    profileIds.add(profile.id);
  }

  const workspaceIds = new Set();
  const workspaceNames = new Set();
  for (const workspace of workspaces) {
    const normalizedName = normalizeWorkspaceName(workspace.name);
    if (workspaceIds.has(workspace.id) || workspaceNames.has(normalizedName)) {
      throw new Error('Invalid app store data');
    }
    workspaceIds.add(workspace.id);
    workspaceNames.add(normalizedName);
  }

  if (profiles.some((profile) => (
    profile.workspaceId !== null
    && profile.workspaceId !== undefined
    && !workspaceIds.has(profile.workspaceId)
  ))) {
    throw new Error('Invalid app store data');
  }
}

function isRunningProcess(record) {
  return isRecord(record)
    && isNonEmptyString(record.profileId)
    && isNonEmptyString(record.browserType)
    && isNonEmptyString(record.profilePath)
    && isNonEmptyString(record.executablePath)
    && Number.isSafeInteger(record.pid)
    && record.pid > 0
    && (
      !hasOwn(record, 'terminationUncertain')
      || typeof record.terminationUncertain === 'boolean'
    );
}

function isBrowserSettings(settings) {
  return isRecord(settings)
    && Object.values(settings).every((executablePath) => typeof executablePath === 'string');
}

function validateRawStoreData(data) {
  if (!isRecord(data)) {
    throw new Error('Invalid app store data');
  }
  if (hasOwn(data, 'schemaVersion')) {
    if (
      Number.isSafeInteger(data.schemaVersion)
      && data.schemaVersion > CURRENT_SCHEMA_VERSION
    ) {
      throw new Error('Unsupported app store schema version');
    }
    if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error('Invalid app store data');
    }
  }
  if (
    (hasOwn(data, 'profiles')
      && (!Array.isArray(data.profiles) || !data.profiles.every(isProfile)))
    || (hasOwn(data, 'workspaces')
      && (!Array.isArray(data.workspaces) || !data.workspaces.every(isWorkspace)))
    || (hasOwn(data, 'runningBrowserProcesses') && (
      !Array.isArray(data.runningBrowserProcesses)
      || !data.runningBrowserProcesses.every(isRunningProcess)
    ))
    || (hasOwn(data, 'browserSettings') && !isBrowserSettings(data.browserSettings))
    || (hasOwn(data, 'appSettings') && !isRecord(data.appSettings))
  ) {
    throw new Error('Invalid app store data');
  }
  validateStoreCollections(data.profiles || [], data.workspaces || []);
}

function clone(value) {
  return structuredClone(value);
}

function migrateStoreData(input = {}) {
  validateRawStoreData(input);
  const profiles = hasOwn(input, 'profiles') ? input.profiles : [];
  const migrated = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles: profiles.map((profile) => ({
      ...profile,
      workspaceId: hasOwn(profile, 'workspaceId') ? profile.workspaceId : null,
      favorite: hasOwn(profile, 'favorite') ? profile.favorite : false,
      lastLaunchedAt: hasOwn(profile, 'lastLaunchedAt') ? profile.lastLaunchedAt : null,
    })),
    workspaces: hasOwn(input, 'workspaces') ? input.workspaces : [],
    browserSettings: hasOwn(input, 'browserSettings') ? input.browserSettings : {},
    runningBrowserProcesses: hasOwn(input, 'runningBrowserProcesses')
      ? input.runningBrowserProcesses : [],
    appSettings: hasOwn(input, 'appSettings') ? input.appSettings : {},
  };
  validateStoreCollections(migrated.profiles, migrated.workspaces);
  return migrated;
}

function createAppStore(store) {
  const snapshot = store.store;
  const migrated = migrateStoreData(snapshot);
  if (!isDeepStrictEqual(snapshot, migrated)) {
    store.store = clone(migrated);
  }

  function get(key) {
    return clone(store.get(key));
  }

  function set(key, value) {
    store.set(key, clone(value));
  }

  function setProfilesAndWorkspaces(profiles, workspaces) {
    validateStoreCollections(profiles, workspaces);
    store.store = {
      ...store.store,
      profiles: clone(profiles),
      workspaces: clone(workspaces),
    };
  }

  return {
    getProfiles: () => get('profiles'),
    setProfiles(profiles) {
      validateStoreCollections(profiles, get('workspaces'));
      set('profiles', profiles);
    },
    setProfilesAndWorkspaces,
    getBrowserSettings: () => get('browserSettings'),
    setBrowserSettings: (settings) => set('browserSettings', settings),
    getRunningProcesses: () => get('runningBrowserProcesses'),
    setRunningProcesses: (records) => set('runningBrowserProcesses', records),
    getWorkspaces: () => get('workspaces'),
    setWorkspaces(workspaces) {
      validateStoreCollections(get('profiles'), workspaces);
      set('workspaces', workspaces);
    },
    getAppSettings: () => get('appSettings'),
    setAppSettings: (settings) => set('appSettings', settings),
  };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  migrateStoreData,
  createAppStore,
};
