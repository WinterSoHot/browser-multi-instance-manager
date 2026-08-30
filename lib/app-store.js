const { isDeepStrictEqual } = require('node:util');

const CURRENT_SCHEMA_VERSION = 1;
const MAX_WORKSPACE_NAME_LENGTH = 80;
const APP_SETTINGS_SCHEMA = Object.freeze({
  closeToTray: Object.freeze({
    defaultValue: true,
    isValid: (value) => typeof value === 'boolean',
  }),
});
const APP_SETTINGS_KEYS = Object.freeze(Object.keys(APP_SETTINGS_SCHEMA));
const DEFAULT_APP_SETTINGS = Object.freeze(Object.fromEntries(APP_SETTINGS_KEYS.map((key) => [
  key,
  APP_SETTINGS_SCHEMA[key].defaultValue,
])));

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

function validateAppSettingsPatch(settings) {
  if (
    !isRecord(settings)
    || Object.keys(settings).length === 0
  ) {
    throw new Error('Invalid app settings');
  }
  const patch = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!hasOwn(APP_SETTINGS_SCHEMA, key) || !APP_SETTINGS_SCHEMA[key].isValid(value)) {
      throw new Error('Invalid app settings');
    }
    patch[key] = value;
  }
  return patch;
}

function validateAppSettings(settings) {
  const patch = validateAppSettingsPatch(settings);
  if (Object.keys(patch).length !== APP_SETTINGS_KEYS.length) {
    throw new Error('Invalid app settings');
  }
  return Object.fromEntries(APP_SETTINGS_KEYS.map((key) => [key, patch[key]]));
}

function normalizeAppSettings(settings) {
  if (!isRecord(settings)) throw new Error('Invalid app store data');
  if (Object.keys(settings).length === 0) return { ...DEFAULT_APP_SETTINGS };
  try {
    return { ...DEFAULT_APP_SETTINGS, ...validateAppSettingsPatch(settings) };
  } catch {
    throw new Error('Invalid app store data');
  }
}

function isRawAppSettings(settings) {
  try {
    normalizeAppSettings(settings);
    return true;
  } catch {
    return false;
  }
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
    || (hasOwn(data, 'appSettings') && !isRawAppSettings(data.appSettings))
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
    appSettings: hasOwn(input, 'appSettings')
      ? normalizeAppSettings(input.appSettings)
      : { ...DEFAULT_APP_SETTINGS },
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
    setAppSettings: (settings) => set('appSettings', validateAppSettings(settings)),
  };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  APP_SETTINGS_SCHEMA,
  DEFAULT_APP_SETTINGS,
  migrateStoreData,
  createAppStore,
  validateAppSettings,
  validateAppSettingsPatch,
};
