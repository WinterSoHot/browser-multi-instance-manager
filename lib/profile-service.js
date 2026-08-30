const {
  createCloneProfileName,
  createProfileExport,
  createProfileRecord,
  isDuplicateProfileName,
  isStoredProfilePathSafe,
  resolveProfilePath,
  validateProfileImportDocument,
  validateProfileInput,
} = require('./profile-utils');

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

  function add({ browserType, profileName } = {}) {
    return profileOperations.runGlobalMutation(async () => {
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
  }

  function remove(payload) {
    const { profileId, trashData = false } = typeof payload === 'string'
      ? { profileId: payload }
      : (payload || {});
    return profileOperations.runMutation(profileId, async () => {
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
  }

  function rename({ profileId, newName } = {}) {
    return profileOperations.runMutation(profileId, async () => {
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
        } catch (error) {
          return { success: false, error: `Failed to rename directory: ${error.message}` };
        }
      }

      profile.name = newName;
      profile.path = newPath;
      appStore.setProfiles(profiles);
      return { success: true, profile };
    });
  }

  function cloneBlank(profileId) {
    return profileOperations.runGlobalMutation(async () => {
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
  }

  async function size(profileId) {
    const profile = appStore.getProfiles().find((candidate) => candidate.id === profileId);
    if (!profile) return { success: false, error: 'Profile not found' };
    if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
      return { success: false, error: 'Profile path is invalid' };
    }
    if (!(await pathExists(profile.path))) return { success: true, bytes: 0 };
    try {
      return { success: true, bytes: await getDirectorySize(profile.path) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function openFolder(profileId) {
    const profile = appStore.getProfiles().find((candidate) => candidate.id === profileId);
    if (!profile) return { success: false, error: 'Profile not found' };
    if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
      return { success: false, error: 'Profile path is invalid' };
    }
    if (!(await pathExists(profile.path))) {
      return { success: false, error: 'Profile folder not found' };
    }

    const errorMessage = await openPath(profile.path);
    if (errorMessage) return { success: false, error: errorMessage };
    return { success: true };
  }

  async function launch(profileId) {
    const result = await profileOperations.runLifecycle(profileId, async () => {
      const profile = appStore.getProfiles().find((candidate) => candidate.id === profileId);
      if (!profile) return { success: false, error: 'Profile not found' };
      if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
        return { success: false, error: 'Profile path is invalid' };
      }

      const executablePath = getBrowserExecutable(profile.browserType);
      if (!executablePath || !(await pathExists(executablePath))) {
        return {
          success: false,
          error: `${profile.browserType} not found at ${executablePath}`,
        };
      }

      const result = await browserProcessManager.launch({
        profileId,
        browserType: profile.browserType,
        profilePath: profile.path,
        executablePath,
      });
      return result;
    });
    if (result?.success === true) await markLaunched(profileId, now());
    return result;
  }

  async function exportMetadata() {
    const result = await showSaveDialog({
      defaultPath: 'browser-profiles.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    const document = createProfileExport(appStore.getProfiles());
    await writeExportFile(result.filePath, `${JSON.stringify(document, null, 2)}\n`);
    return { success: true, count: document.profiles.length };
  }

  async function importMetadata() {
    const result = await showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    try {
      const document = JSON.parse(await readImportFile(result.filePaths[0]));
      const importedMetadata = validateProfileImportDocument(document);
      return await profileOperations.runGlobalMutation(async () => {
        const profiles = appStore.getProfiles();
        const imported = [];
        let skipped = 0;
        for (const metadata of importedMetadata) {
          if (isDuplicateProfileName(profiles, metadata.browserType, metadata.name)) {
            skipped += 1;
            continue;
          }
          const profilePath = await createProfileDir(metadata.browserType, metadata.name);
          const profile = createProfileRecord({
            browserType: metadata.browserType,
            profileName: metadata.name,
            profilePath,
          });
          profiles.push(profile);
          imported.push(profile);
        }
        appStore.setProfiles(profiles);
        return { success: true, profiles: imported, skipped };
      });
    } catch (error) {
      return { success: false, error: error.message };
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
    importMetadata,
    previewImportMetadata,
    executeImport,
  };
}

module.exports = { createProfileService };
