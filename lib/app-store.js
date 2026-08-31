const { isDeepStrictEqual, types } = require('node:util');
const { parseSemver, validateReleaseUrl } = require('./update-checker');

const CURRENT_SCHEMA_VERSION = 1;
const MAX_WORKSPACE_NAME_LENGTH = 80;
const APP_SETTINGS_SCHEMA = Object.freeze({
  closeToTray: Object.freeze({
    defaultValue: true,
    isValid: (value) => typeof value === 'boolean',
  }),
  checkUpdatesOnStartup: Object.freeze({
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
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && !types.isProxy(value));
}

function isPlainRecord(value) {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function readExactJsonRecord(record, keys) {
  try {
    if (!isPlainRecord(record)) return null;
    const actualKeys = Reflect.ownKeys(record);
    if (!actualKeys.every((key) => typeof key === 'string')) return null;
    actualKeys.sort();
    if (actualKeys.length !== keys.length
      || !actualKeys.every((key, index) => key === keys[index])) {
      return null;
    }

    const snapshot = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || descriptor.enumerable !== true || !hasOwn(descriptor, 'value')) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
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

function validateUpdateCheckCacheResult(result) {
  const currentResult = readExactJsonRecord(result, ['status']);
  if (currentResult?.status === 'current') {
    return { status: 'current' };
  }
  const availableResult = readExactJsonRecord(result, ['releaseUrl', 'status', 'version']);
  if (!availableResult || availableResult.status !== 'available') {
    throw new Error('Invalid update check cache');
  }

  const { version, releaseUrl } = availableResult;
  if (typeof version !== 'string' || typeof releaseUrl !== 'string' || !parseSemver(version)) {
    throw new Error('Invalid update check cache');
  }
  try {
    if (validateReleaseUrl(releaseUrl) !== version) throw new Error('Invalid update check cache');
  } catch {
    throw new Error('Invalid update check cache');
  }
  return { status: 'available', version, releaseUrl };
}

function validateUpdateCheckCache(cache) {
  if (cache === null) return null;
  const cacheRecord = readExactJsonRecord(cache, ['checkedAt', 'checkedVersion', 'result']);
  if (!cacheRecord) {
    throw new Error('Invalid update check cache');
  }

  const { checkedAt, checkedVersion, result } = cacheRecord;
  if (!Number.isSafeInteger(checkedAt) || checkedAt < 0
    || typeof checkedVersion !== 'string' || !parseSemver(checkedVersion)) {
    throw new Error('Invalid update check cache');
  }
  return { checkedAt, checkedVersion, result: validateUpdateCheckCacheResult(result) };
}

function readPersistedUpdateCheckCache(data) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(data, 'updateCheckCache');
  } catch {
    return { value: null, needsCleanup: true };
  }
  if (!descriptor) return { value: null, needsCleanup: false };
  if (descriptor.enumerable !== true || !hasOwn(descriptor, 'value')) {
    return { value: null, needsCleanup: true };
  }
  try {
    return { value: validateUpdateCheckCache(descriptor.value), needsCleanup: false };
  } catch {
    return { value: null, needsCleanup: true };
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

function migrateStoreDataWithMetadata(input = {}) {
  validateRawStoreData(input);
  const persistedCache = readPersistedUpdateCheckCache(input);
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
    updateCheckCache: persistedCache.value,
  };
  validateStoreCollections(migrated.profiles, migrated.workspaces);
  return { migrated, needsCacheCleanup: persistedCache.needsCleanup };
}

function migrateStoreData(input = {}) {
  return migrateStoreDataWithMetadata(input).migrated;
}

function hasOnlyOptionalCacheDifference(snapshot, migrated) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(snapshot);
    const persistedWithoutCache = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === 'updateCheckCache') continue;
      if (typeof key !== 'string') return false;
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !hasOwn(descriptor, 'value')) {
        return false;
      }
      persistedWithoutCache[key] = descriptor.value;
    }
    const { updateCheckCache: _cache, ...migratedWithoutCache } = migrated;
    return isDeepStrictEqual(persistedWithoutCache, migratedWithoutCache);
  } catch {
    return false;
  }
}

function createAppStore(store) {
  const snapshot = store.store;
  const { migrated, needsCacheCleanup } = migrateStoreDataWithMetadata(snapshot);
  let inMemorySnapshot = null;
  if (needsCacheCleanup || !isDeepStrictEqual(snapshot, migrated)) {
    try {
      store.store = clone(migrated);
    } catch (error) {
      if (!needsCacheCleanup || !hasOnlyOptionalCacheDifference(snapshot, migrated)) {
        throw error;
      }
      inMemorySnapshot = clone(migrated);
    }
  }

  function get(key) {
    return clone(inMemorySnapshot ? inMemorySnapshot[key] : store.get(key));
  }

  function set(key, value) {
    const nextValue = clone(value);
    store.set(key, nextValue);
    if (inMemorySnapshot) inMemorySnapshot[key] = clone(nextValue);
  }

  function setProfilesAndWorkspaces(profiles, workspaces) {
    validateStoreCollections(profiles, workspaces);
    const currentSnapshot = inMemorySnapshot || store.store;
    store.store = {
      ...currentSnapshot,
      profiles: clone(profiles),
      workspaces: clone(workspaces),
    };
    inMemorySnapshot = null;
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
    getUpdateCheckCache: () => get('updateCheckCache'),
    setUpdateCheckCache(cache) {
      set('updateCheckCache', validateUpdateCheckCache(cache));
      inMemorySnapshot = null;
    },
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
  validateUpdateCheckCache,
};
