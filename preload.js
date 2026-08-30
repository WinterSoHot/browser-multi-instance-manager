const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  addProfile: (browserType, profileName) =>
    ipcRenderer.invoke('add-profile', { browserType, profileName }),
  deleteProfile: (profileId, trashData = false) =>
    ipcRenderer.invoke('delete-profile', { profileId, trashData }),
  cloneProfile: (profileId) => ipcRenderer.invoke('clone-profile', profileId),
  getProfileSize: (profileId) => ipcRenderer.invoke('get-profile-size', profileId),
  exportProfiles: () => ipcRenderer.invoke('export-profiles'),
  previewImport: () => ipcRenderer.invoke('preview-import'),
  executeImport: (token, decisions) => (
    ipcRenderer.invoke('execute-import', { token, decisions })
  ),
  launchBrowser: (profileId) => ipcRenderer.invoke('launch-browser', profileId),
  closeBrowser: (profileId) => ipcRenderer.invoke('close-browser', profileId),
  getBrowserStatus: (profileId) => ipcRenderer.invoke('get-browser-status', profileId),
  getBrowserStatuses: (profileIds, options) => (
    options === undefined
      ? ipcRenderer.invoke('get-browser-statuses', profileIds)
      : ipcRenderer.invoke('get-browser-statuses', profileIds, options)
  ),
  refreshBrowserStatus: (profileId) => ipcRenderer.invoke('refresh-browser-status', profileId),
  forgetBrowserProcess: (profileId, acknowledgePossibleRunning = false) =>
    ipcRenderer.invoke('forget-browser-process', { profileId, acknowledgePossibleRunning }),
  onBrowserStatusesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('browser-statuses-changed', listener);
    return () => ipcRenderer.removeListener('browser-statuses-changed', listener);
  },
  renameProfile: (profileId, newName) =>
    ipcRenderer.invoke('rename-profile', { profileId, newName }),
  openProfileFolder: (profileId) => ipcRenderer.invoke('open-profile-folder', profileId),
  // New browser settings APIs
  getBrowserSettings: () => ipcRenderer.invoke('get-browser-settings'),
  setBrowserSettings: (settings) => ipcRenderer.invoke('set-browser-settings', settings),
  getDefaultBrowserPath: (browserType) => ipcRenderer.invoke('get-default-browser-path', browserType),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getBrowserEnvironment: () => ipcRenderer.invoke('get-browser-environment'),
  browseFolder: (defaultPath) => ipcRenderer.invoke('browse-folder', defaultPath),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings) => ipcRenderer.invoke('set-app-settings', settings),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: (force) => {
    if (typeof force !== 'boolean') {
      return Promise.resolve({ status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED' });
    }
    return ipcRenderer.invoke('check-for-updates', { force });
  },
  openReleasePage: (releaseUrl) => ipcRenderer.invoke('open-release-page', releaseUrl),
  onUpdateCheckResult: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('update-check-result', listener);
    return () => ipcRenderer.removeListener('update-check-result', listener);
  },
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  createWorkspace: (name) => ipcRenderer.invoke('create-workspace', { name }),
  renameWorkspace: (workspaceId, name) => (
    ipcRenderer.invoke('rename-workspace', { workspaceId, name })
  ),
  deleteWorkspace: (workspaceId) => (
    ipcRenderer.invoke('delete-workspace', { workspaceId })
  ),
  assignProfileWorkspace: (profileId, workspaceId) => (
    ipcRenderer.invoke('assign-profile-workspace', { profileId, workspaceId })
  ),
  setProfileFavorite: (profileId, favorite) => (
    ipcRenderer.invoke('set-profile-favorite', { profileId, favorite })
  ),
  inspectProfileDiagnostics: (profileId) => (
    ipcRenderer.invoke('inspect-profile-diagnostics', profileId)
  ),
  repairProfileDirectory: (profileId) => (
    ipcRenderer.invoke('repair-profile-directory', profileId)
  ),
});
