const {
  isStoredProfilePathSafe,
  resolveProfilePath,
} = require('./profile-utils');

const DIAGNOSTIC_ACTIONS = {
  RETRY: 'retry',
  OPEN_SETTINGS: 'open-settings',
  RECREATE_EMPTY_DIRECTORY: 'recreate-empty-directory',
};

const diagnosticsUnavailable = () => ({
  code: 'DIAGNOSTICS_UNAVAILABLE',
  state: 'process-unknown',
  actions: [DIAGNOSTIC_ACTIONS.RETRY],
});

function getProcessState(status) {
  if (
    !status
    || typeof status !== 'object'
    || Array.isArray(status)
    || typeof status.running !== 'boolean'
    || (
      Object.prototype.hasOwnProperty.call(status, 'verificationUnavailable')
      && typeof status.verificationUnavailable !== 'boolean'
    )
    || status.verificationUnavailable === true
  ) {
    return 'unknown';
  }
  return status.running ? 'running' : 'stopped';
}

function getExpectedProfilePath(baseDir, profile) {
  if (!isStoredProfilePathSafe(baseDir, profile)) return null;
  try {
    const expectedPath = resolveProfilePath(baseDir, profile.browserType, profile.name);
    return profile.path === expectedPath ? expectedPath : null;
  } catch {
    return null;
  }
}

function createDiagnosticsService({
  appStore,
  profileOperations,
  browserProcessManager,
  getBrowserExecutable,
  getProfilesDir,
  pathExists,
  createEmptyProfileDir,
}) {
  function getProfile(profileId) {
    return appStore.getProfiles().find((profile) => profile.id === profileId) || null;
  }

  async function inspectInternal(profileId) {
    const profile = getProfile(profileId);
    if (!profile) {
      return { code: 'PROFILE_NOT_FOUND', state: 'process-unknown', actions: [] };
    }

    const processState = getProcessState(await browserProcessManager.getStatus(profileId));
    if (processState === 'unknown') {
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

    const expectedPath = getExpectedProfilePath(getProfilesDir(), profile);
    if (!expectedPath) {
      return {
        code: 'PROFILE_PATH_INVALID',
        state: 'profile-directory-missing',
        actions: [DIAGNOSTIC_ACTIONS.RETRY],
      };
    }

    let directoryExists;
    try {
      directoryExists = await pathExists(expectedPath);
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
        actions: processState === 'stopped'
          ? [DIAGNOSTIC_ACTIONS.RETRY, DIAGNOSTIC_ACTIONS.RECREATE_EMPTY_DIRECTORY]
          : [DIAGNOSTIC_ACTIONS.RETRY],
      };
    }

    return { code: 'HEALTHY', state: 'healthy', actions: [] };
  }

  async function inspect(profileId) {
    try {
      return await inspectInternal(profileId);
    } catch {
      return diagnosticsUnavailable();
    }
  }

  async function repairMissingDirectory(profileId) {
    try {
      return await profileOperations.runMutation(profileId, async () => {
        const profile = getProfile(profileId);
        if (!profile) return { success: false, code: 'PROFILE_NOT_FOUND' };

        const expectedPath = getExpectedProfilePath(getProfilesDir(), profile);
        if (!expectedPath) {
          return { success: false, code: 'PROFILE_PATH_INVALID' };
        }

        const processState = getProcessState(
          await browserProcessManager.getStatus(profileId, { force: true }),
        );
        if (processState === 'unknown') {
          return { success: false, code: 'PROCESS_STATE_UNKNOWN' };
        }
        if (processState === 'running') return { success: false, code: 'PROFILE_RUNNING' };

        try {
          if (await pathExists(expectedPath)) {
            return { success: false, code: 'DIRECTORY_PRESENT' };
          }
        } catch {
          return { success: false, code: 'PROFILE_DIRECTORY_UNAVAILABLE' };
        }

        try {
          const createdPath = await createEmptyProfileDir(profile.browserType, profile.name);
          if (createdPath !== expectedPath) {
            return { success: false, code: 'CREATE_PATH_MISMATCH' };
          }
        } catch (error) {
          return {
            success: false,
            code: error && error.code === 'EEXIST'
              ? 'DIRECTORY_PRESENT'
              : 'DIRECTORY_CREATE_FAILED',
          };
        }
        return { success: true, code: 'DIRECTORY_RECREATED' };
      });
    } catch {
      return { success: false, code: 'DIAGNOSTICS_UNAVAILABLE' };
    }
  }

  return { inspect, repairMissingDirectory };
}

module.exports = { createDiagnosticsService, DIAGNOSTIC_ACTIONS };
