const {
  createCloneProfileName,
  createProfileExport,
  createProfileRecord,
  isDuplicateProfileName,
  isStoredProfilePathSafe,
  resolveProfilePath,
  validateProfileInput,
} = require('./profile-utils');

function operationFailure(code, error) {
  return { success: false, code, error };
}

function createProfileService({
  appStore,
  profileOperations,
  browserProcessManager,
  getBrowserExecutable,
  getProfilesDir,
  createProfileDir,
  pathExists,
  getDirectorySize,
  renameDirectory,
  trashItem,
  openPath,
  showSaveDialog,
  showOpenDialog,
  readImportFile,
  writeExportFile,
  importExportService,
  now = () => new Date().toISOString(),
}) {
  function list() {
    return appStore.getProfiles();
  }

  function updateLastLaunchedAt(profileId, timestamp) {
    const profiles = appStore.getProfiles();
    const profileIndex = profiles.findIndex((profile) => profile.id === profileId);
    if (profileIndex === -1) return { success: false, error: 'Profile not found' };

    const profile = { ...profiles[profileIndex], lastLaunchedAt: timestamp };
    profiles[profileIndex] = profile;
    appStore.setProfiles(profiles);
    return { success: true, profile };
  }

  function markLaunched(profileId, timestamp) {
    return profileOperations.runGlobalMutation(
      () => updateLastLaunchedAt(profileId, timestamp),
    );
  }

  async function add({ browserType, profileName } = {}) {
    try {
      return await profileOperations.runGlobalMutation(async () => {
        try {
          validateProfileInput(browserType, profileName);
        } catch (error) {
          return { success: false, error: error.message };
        }

        const profiles = appStore.getProfiles();
        if (isDuplicateProfileName(profiles, browserType, profileName)) {
          return { success: false, error: 'Profile name already exists' };
        }

        const profilePath = await createProfileDir(browserType, profileName);
        const profile = createProfileRecord({
          browserType,
          profileName,
          profilePath,
        });
        profiles.push(profile);
        appStore.setProfiles(profiles);

        return { success: true, profile };
      });
    } catch {
      return operationFailure('PROFILE_ADD_FAILED', 'Unable to add profile');
    }
  }

  async function remove(payload) {
    const { profileId, trashData = false } = typeof payload === 'string'
      ? { profileId: payload }
      : (payload || {});
    try {
      return await profileOperations.runMutation(profileId, async () => {
        const profiles = appStore.getProfiles();
        const profile = profiles.find((candidate) => candidate.id === profileId);
        if (!profile) return { success: false, error: 'Profile not found' };

        const { running } = await browserProcessManager.getStatus(profileId, { force: true });
        if (running) {
          return { success: false, error: 'Close the browser before removing its profile' };
        }

        if (trashData) {
          if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
            return { success: false, error: 'Profile path is invalid' };
          }
          if (await pathExists(profile.path)) await trashItem(profile.path);
        }

        appStore.setProfiles(profiles.filter((candidate) => candidate.id !== profileId));
        return { success: true };
      });
    } catch {
      return operationFailure('PROFILE_REMOVE_FAILED', 'Unable to remove profile');
    }
  }

  async function rename({ profileId, newName } = {}) {
    try {
      return await profileOperations.runMutation(profileId, async () => {
        const profiles = appStore.getProfiles();
        const profileIndex = profiles.findIndex((profile) => profile.id === profileId);
        if (profileIndex === -1) return { success: false, error: 'Profile not found' };

        const { running } = await browserProcessManager.getStatus(profileId, { force: true });
        if (running) {
          return { success: false, error: 'Close the browser before renaming its profile' };
        }

        const profile = profiles[profileIndex];
        try {
          validateProfileInput(profile.browserType, newName);
        } catch (error) {
          return { success: false, error: error.message };
        }

        if (isDuplicateProfileName(profiles, profile.browserType, newName, profileId)) {
          return { success: false, error: 'Profile name already exists' };
        }
        if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
          return { success: false, error: 'Profile path is invalid' };
        }

        const oldPath = profile.path;
        const newPath = resolveProfilePath(getProfilesDir(), profile.browserType, newName);
        if (await pathExists(oldPath)) {
          try {
            await renameDirectory(oldPath, newPath);
          } catch {
            return operationFailure('PROFILE_RENAME_FAILED', 'Unable to rename profile');
          }
        }

        profile.name = newName;
        profile.path = newPath;
        appStore.setProfiles(profiles);
        return { success: true, profile };
      });
    } catch {
      return operationFailure('PROFILE_RENAME_FAILED', 'Unable to rename profile');
    }
  }

  async function cloneBlank(profileId) {
    try {
      return await profileOperations.runGlobalMutation(async () => {
        const profiles = appStore.getProfiles();
        const source = profiles.find((profile) => profile.id === profileId);
        if (!source) return { success: false, error: 'Profile not found' };

        const profileName = createCloneProfileName(profiles, source.browserType, source.name);
        const profilePath = await createProfileDir(source.browserType, profileName);
        const profile = createProfileRecord({
          browserType: source.browserType,
          profileName,
          profilePath,
        });
        profiles.push(profile);
        appStore.setProfiles(profiles);
        return { success: true, profile };
      });
    } catch {
      return operationFailure('PROFILE_CLONE_FAILED', 'Unable to clone profile');
    }
  }

  async function size(profileId) {
    try {
      const profile = appStore.getProfiles().find((candidate) => candidate.id === profileId);
      if (!profile) return { success: false, error: 'Profile not found' };
      if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
        return { success: false, error: 'Profile path is invalid' };
      }
      if (!(await pathExists(profile.path))) return { success: true, bytes: 0 };
      return { success: true, bytes: await getDirectorySize(profile.path) };
    } catch {
      return operationFailure('PROFILE_SIZE_FAILED', 'Unable to read profile size');
    }
  }

  async function openFolder(profileId) {
    try {
      const profile = appStore.getProfiles().find((candidate) => candidate.id === profileId);
      if (!profile) return { success: false, error: 'Profile not found' };
      if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
        return { success: false, error: 'Profile path is invalid' };
      }
      if (!(await pathExists(profile.path))) {
        return { success: false, error: 'Profile folder not found' };
      }

      const errorMessage = await openPath(profile.path);
      if (errorMessage) {
        return operationFailure('PROFILE_OPEN_FAILED', 'Unable to open profile folder');
      }
      return { success: true };
    } catch {
      return operationFailure('PROFILE_OPEN_FAILED', 'Unable to open profile folder');
    }
  }

  async function launch(profileId) {
    let result;
    try {
      result = await profileOperations.runLifecycle(profileId, async () => {
        const profile = appStore.getProfiles().find((candidate) => candidate.id === profileId);
        if (!profile) return { success: false, error: 'Profile not found' };
        if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
          return { success: false, error: 'Profile path is invalid' };
        }

        const executablePath = getBrowserExecutable(profile.browserType);
        if (!executablePath || !(await pathExists(executablePath))) {
          return operationFailure('BROWSER_PATH_INVALID', 'Browser path is invalid');
        }

        return browserProcessManager.launch({
          profileId,
          browserType: profile.browserType,
          profilePath: profile.path,
          executablePath,
        });
      });
    } catch {
      return operationFailure('PROFILE_LAUNCH_FAILED', 'Unable to launch browser');
    }
    if (result?.success !== true) {
      if (result?.error === 'Browser already running' || result?.error === 'Browser is already running') {
        return operationFailure('BROWSER_ALREADY_RUNNING', 'Browser already running');
      }
      if (result?.code === 'BROWSER_PATH_INVALID') return result;
      if (result?.error === 'Profile not found' || result?.error === 'Profile path is invalid') {
        return result;
      }
      return operationFailure('PROFILE_LAUNCH_FAILED', 'Unable to launch browser');
    }
    if (result?.success === true) {
      try {
        const metadataResult = await markLaunched(profileId, now());
        if (metadataResult?.success !== true) {
          return { success: true, warningCode: 'LAST_LAUNCHED_AT_NOT_RECORDED' };
        }
      } catch {
        return { success: true, warningCode: 'LAST_LAUNCHED_AT_NOT_RECORDED' };
      }
    }
    return { success: true };
  }

  async function exportMetadata() {
    try {
      const result = await showSaveDialog({
        defaultPath: 'browser-profiles.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };

      const document = createProfileExport(appStore.getProfiles());
      await writeExportFile(result.filePath, `${JSON.stringify(document, null, 2)}\n`);
      return { success: true, count: document.profiles.length };
    } catch {
      return operationFailure('PROFILE_EXPORT_FAILED', 'Unable to export profiles');
    }
  }

  async function previewImportMetadata() {
    try {
      const result = await showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
        return { success: false, code: 'IMPORT_CANCELED' };
      }
      const document = JSON.parse(await readImportFile(result.filePaths[0]));
      return importExportService.previewImport(document);
    } catch {
      return { success: false, code: 'INVALID_IMPORT_DOCUMENT' };
    }
  }

  function executeImport(payload) {
    return importExportService.executeImport(payload);
  }

  return {
    list,
    add,
    remove,
    rename,
    cloneBlank,
    size,
    openFolder,
    launch,
    markLaunched,
    exportMetadata,
    previewImportMetadata,
    executeImport,
  };
}

module.exports = { createProfileService };
