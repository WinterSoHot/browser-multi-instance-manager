const {
  isStoredProfilePathSafe,
  resolveProfilePath,
} = require('./profile-utils');

const DIAGNOSTIC_ACTIONS = {
  RETRY: 'retry',
  OPEN_SETTINGS: 'open-settings',
  RECREATE_EMPTY_DIRECTORY: 'recreate-empty-directory',
};

function createDiagnosticsService({
  appStore,
  profileOperations,
  browserProcessManager,
  getBrowserExecutable,
  getProfilesDir,
  pathExists,
  createProfileDir,
}) {
  function getProfile(profileId) {
    return appStore.getProfiles().find((profile) => profile.id === profileId) || null;
  }

  async function inspect(profileId) {
    const profile = getProfile(profileId);
    if (!profile) {
      return { code: 'PROFILE_NOT_FOUND', state: 'process-unknown', actions: [] };
    }

    let processStatus;
    try {
      processStatus = await browserProcessManager.getStatus(profileId);
    } catch {
      processStatus = { verificationUnavailable: true };
    }
    if (processStatus?.verificationUnavailable) {
      return {
        code: 'PROCESS_STATE_UNKNOWN',
        state: 'process-unknown',
        actions: [DIAGNOSTIC_ACTIONS.RETRY],
      };
    }

    let browserPathValid;
    try {
      const executablePath = getBrowserExecutable(profile.browserType);
      browserPathValid = Boolean(executablePath && await pathExists(executablePath));
    } catch {
      browserPathValid = false;
    }
    if (!browserPathValid) {
      return {
        code: 'BROWSER_PATH_INVALID',
        state: 'browser-path-invalid',
        actions: [DIAGNOSTIC_ACTIONS.RETRY, DIAGNOSTIC_ACTIONS.OPEN_SETTINGS],
      };
    }

    const baseDir = getProfilesDir();
    if (!isStoredProfilePathSafe(baseDir, profile)) {
      return {
        code: 'PROFILE_PATH_INVALID',
        state: 'profile-directory-missing',
        actions: [DIAGNOSTIC_ACTIONS.RETRY],
      };
    }

    let directoryExists;
    try {
      directoryExists = await pathExists(profile.path);
    } catch {
      return {
        code: 'PROFILE_DIRECTORY_UNAVAILABLE',
        state: 'profile-directory-missing',
        actions: [DIAGNOSTIC_ACTIONS.RETRY],
      };
    }
    if (!directoryExists) {
      return {
        code: 'PROFILE_DIRECTORY_MISSING',
        state: 'profile-directory-missing',
        actions: processStatus?.running
          ? [DIAGNOSTIC_ACTIONS.RETRY]
          : [DIAGNOSTIC_ACTIONS.RETRY, DIAGNOSTIC_ACTIONS.RECREATE_EMPTY_DIRECTORY],
      };
    }

    return { code: 'HEALTHY', state: 'healthy', actions: [] };
  }

  function repairMissingDirectory(profileId) {
    return profileOperations.runMutation(profileId, async () => {
      const profile = getProfile(profileId);
      if (!profile) return { success: false, code: 'PROFILE_NOT_FOUND' };

      const baseDir = getProfilesDir();
      if (!isStoredProfilePathSafe(baseDir, profile)) {
        return { success: false, code: 'PROFILE_PATH_INVALID' };
      }
      let expectedPath;
      try {
        expectedPath = resolveProfilePath(baseDir, profile.browserType, profile.name);
      } catch {
        return { success: false, code: 'PROFILE_PATH_INVALID' };
      }

      let processStatus;
      try {
        processStatus = await browserProcessManager.getStatus(profileId, { force: true });
      } catch {
        return { success: false, code: 'PROCESS_STATE_UNKNOWN' };
      }
      if (processStatus?.verificationUnavailable) {
        return { success: false, code: 'PROCESS_STATE_UNKNOWN' };
      }
      if (processStatus?.running) return { success: false, code: 'PROFILE_RUNNING' };

      try {
        if (await pathExists(expectedPath)) {
          return { success: false, code: 'DIRECTORY_PRESENT' };
        }
        if (await pathExists(expectedPath)) {
          return { success: false, code: 'DIRECTORY_PRESENT' };
        }
      } catch {
        return { success: false, code: 'PROFILE_DIRECTORY_UNAVAILABLE' };
      }

      try {
        const createdPath = await createProfileDir(profile.browserType, profile.name);
        if (createdPath !== expectedPath) {
          return { success: false, code: 'CREATE_PATH_MISMATCH' };
        }
      } catch {
        return { success: false, code: 'DIRECTORY_CREATE_FAILED' };
      }
      return { success: true, code: 'DIRECTORY_RECREATED' };
    });
  }

  return { inspect, repairMissingDirectory };
}

module.exports = { createDiagnosticsService, DIAGNOSTIC_ACTIONS };
