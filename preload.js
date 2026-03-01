const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  addProfile: (browserType, profileName) =>
    ipcRenderer.invoke('add-profile', { browserType, profileName }),
  deleteProfile: (profileId) => ipcRenderer.invoke('delete-profile', profileId),
  launchBrowser: (profileId) => ipcRenderer.invoke('launch-browser', profileId),
  closeBrowser: (profileId) => ipcRenderer.invoke('close-browser', profileId),
  getBrowserStatus: (profileId) => ipcRenderer.invoke('get-browser-status', profileId),
  renameProfile: (profileId, newName) =>
    ipcRenderer.invoke('rename-profile', { profileId, newName }),
  openProfileFolder: (profileId) => ipcRenderer.invoke('open-profile-folder', profileId),
  // New browser settings APIs
  getBrowserSettings: () => ipcRenderer.invoke('get-browser-settings'),
  setBrowserSettings: (settings) => ipcRenderer.invoke('set-browser-settings', settings),
  getDefaultBrowserPath: (browserType) => ipcRenderer.invoke('get-default-browser-path', browserType),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  browseFolder: (defaultPath) => ipcRenderer.invoke('browse-folder', defaultPath)
});