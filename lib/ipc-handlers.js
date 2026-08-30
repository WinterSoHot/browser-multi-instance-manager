const {
  validateProfileId,
  validateProfileIds,
} = require('./ipc-validation');

function registerIpcHandlers({
  ipcMain,
  profileService,
  browserProcessManager,
  settingsService,
}) {
  const channels = new Map([
    ['get-profiles', () => profileService.list()],
    ['add-profile', (_event, payload) => profileService.add(payload)],
    ['delete-profile', (_event, payload) => profileService.remove(payload)],
    ['launch-browser', (_event, profileId) => profileService.launch(profileId)],
    ['close-browser', (_event, profileId) => browserProcessManager.close(profileId)],
    ['get-browser-status', (_event, profileId) => browserProcessManager.getStatus(profileId)],
    ['get-browser-statuses', (_event, profileIds = []) => (
      browserProcessManager.getStatuses(validateProfileIds(profileIds))
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
    ['import-profiles', () => profileService.importMetadata()],
    ['get-browser-settings', () => settingsService.get()],
    ['set-browser-settings', (_event, settings) => settingsService.set(settings)],
    ['get-default-browser-path', (_event, browserType) => (
      settingsService.getDefaultPath(browserType)
    )],
    ['get-platform', () => settingsService.getPlatform()],
    ['get-browser-environment', () => settingsService.getEnvironment()],
    ['browse-folder', (_event, defaultPath) => settingsService.browseFolder(defaultPath)],
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
