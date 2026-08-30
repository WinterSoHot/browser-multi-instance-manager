const {
  validateProfileId,
  validateProfileIds,
} = require('./ipc-validation');

function registerIpcHandlers({
  ipcMain,
  profileService,
  browserProcessManager,
  settingsService,
  workspaceService,
}) {
  function validateWorkspaceId(workspaceId) {
    if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
      throw new Error('Invalid workspace ID');
    }
    return workspaceId;
  }

  function validateWorkspaceIdOrNull(workspaceId) {
    return workspaceId === null ? null : validateWorkspaceId(workspaceId);
  }

  function workspacePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid workspace request');
    }
    return payload;
  }

  async function workspaceRequest(operation) {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Error
        && [
          'Invalid workspace request',
          'Invalid workspace ID',
          'Invalid profile ID',
          'Invalid favorite value',
        ].includes(error.message)
      ) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Workspace request failed' };
    }
  }

  function validateStatusOptions(options) {
    if (options === undefined) return { force: false };
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Invalid browser status options');
    }
    if (Object.keys(options).some((key) => key !== 'force') || typeof options.force !== 'boolean') {
      throw new Error('Invalid browser status options');
    }
    return { force: options.force };
  }

  function validateImportRequest(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid import request');
    }
    if (Object.keys(payload).some((key) => key !== 'token' && key !== 'decisions')) {
      throw new Error('Invalid import request');
    }
    if (typeof payload.token !== 'string' || !/^[a-f0-9]{64}$/u.test(payload.token)) {
      throw new Error('Invalid import request');
    }
    if (!Array.isArray(payload.decisions) || payload.decisions.length > 1000) {
      throw new Error('Invalid import request');
    }
    for (const decision of payload.decisions) {
      if (
        !decision
        || typeof decision !== 'object'
        || Array.isArray(decision)
        || Object.keys(decision).some((key) => key !== 'line' && key !== 'action')
        || !Number.isInteger(decision.line)
        || decision.line < 1
        || (decision.action !== 'skip' && decision.action !== 'rename')
      ) {
        throw new Error('Invalid import request');
      }
    }
    return { token: payload.token, decisions: payload.decisions.map(({ line, action }) => ({ line, action })) };
  }

  async function executeImportRequest(payload) {
    try {
      return await profileService.executeImport(validateImportRequest(payload));
    } catch {
      return { success: false, code: 'IMPORT_REQUEST_INVALID' };
    }
  }

  async function previewImportRequest() {
    try {
      return await profileService.previewImportMetadata();
    } catch {
      return { success: false, code: 'IMPORT_PREVIEW_FAILED' };
    }
  }

  const channels = new Map([
    ['get-profiles', () => profileService.list()],
    ['add-profile', (_event, payload) => profileService.add(payload)],
    ['delete-profile', (_event, payload) => profileService.remove(payload)],
    ['launch-browser', (_event, profileId) => profileService.launch(profileId)],
    ['close-browser', (_event, profileId) => browserProcessManager.close(profileId)],
    ['get-browser-status', (_event, profileId) => browserProcessManager.getStatus(profileId)],
    ['get-browser-statuses', (_event, profileIds = [], options) => (
      browserProcessManager.getStatuses(
        validateProfileIds(profileIds),
        validateStatusOptions(options),
      )
    )],
    ['refresh-browser-status', (_event, profileId) => (
      browserProcessManager.getStatus(profileId, { force: true })
    )],
    ['forget-browser-process', (_event, payload = {}) => {
      const { profileId, acknowledgePossibleRunning = false } = payload;
      if (typeof acknowledgePossibleRunning !== 'boolean') {
        return { success: false, error: 'Invalid process record request' };
      }
      try {
        return browserProcessManager.forget(
          validateProfileId(profileId),
          { acknowledgePossibleRunning },
        );
      } catch (error) {
        return { success: false, error: error.message };
      }
    }],
    ['rename-profile', (_event, payload) => profileService.rename(payload)],
    ['open-profile-folder', (_event, profileId) => profileService.openFolder(profileId)],
    ['clone-profile', (_event, profileId) => profileService.cloneBlank(profileId)],
    ['get-profile-size', (_event, profileId) => profileService.size(profileId)],
    ['export-profiles', () => profileService.exportMetadata()],
    ['preview-import', () => previewImportRequest()],
    ['execute-import', (_event, payload) => executeImportRequest(payload)],
    ['get-browser-settings', () => settingsService.get()],
    ['set-browser-settings', (_event, settings) => settingsService.set(settings)],
    ['get-default-browser-path', (_event, browserType) => (
      settingsService.getDefaultPath(browserType)
    )],
    ['get-platform', () => settingsService.getPlatform()],
    ['get-browser-environment', () => settingsService.getEnvironment()],
    ['browse-folder', (_event, defaultPath) => settingsService.browseFolder(defaultPath)],
    ['get-workspaces', () => workspaceService.list()],
    ['create-workspace', (_event, payload) => workspaceRequest(() => (
      workspaceService.create(workspacePayload(payload))
    ))],
    ['rename-workspace', (_event, payload) => workspaceRequest(() => {
      const request = workspacePayload(payload);
      return workspaceService.rename({
        workspaceId: validateWorkspaceId(request.workspaceId),
        name: request.name,
      });
    })],
    ['delete-workspace', (_event, payload) => workspaceRequest(() => {
      const request = workspacePayload(payload);
      return workspaceService.remove({ workspaceId: validateWorkspaceId(request.workspaceId) });
    })],
    ['assign-profile-workspace', (_event, payload) => workspaceRequest(() => {
      const request = workspacePayload(payload);
      return workspaceService.assign({
        profileId: validateProfileId(request.profileId),
        workspaceId: validateWorkspaceIdOrNull(request.workspaceId),
      });
    })],
    ['set-profile-favorite', (_event, payload) => workspaceRequest(() => {
      const request = workspacePayload(payload);
      if (typeof request.favorite !== 'boolean') {
        throw new Error('Invalid favorite value');
      }
      return workspaceService.setFavorite({
        profileId: validateProfileId(request.profileId),
        favorite: request.favorite,
      });
    })],
  ]);

  for (const [channel, handler] of channels) {
    ipcMain.handle(channel, handler);
  }

  return function unregister() {
    for (const channel of channels.keys()) {
      ipcMain.removeHandler(channel);
    }
  };
}

module.exports = { registerIpcHandlers };
