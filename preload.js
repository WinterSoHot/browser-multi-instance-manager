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
  importProfiles: () => ipcRenderer.invoke('import-profiles'),
  launchBrowser: (profileId) => ipcRenderer.invoke('launch-browser', profileId),
  closeBrowser: (profileId) => ipcRenderer.invoke('close-browser', profileId),
  getBrowserStatus: (profileId) => ipcRenderer.invoke('get-browser-status', profileId),
  getBrowserStatuses: (profileIds) => ipcRenderer.invoke('get-browser-statuses', profileIds),
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
  browseFolder: (defaultPath) => ipcRenderer.invoke('browse-folder', defaultPath)
});
