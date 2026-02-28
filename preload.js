const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  addProfile: (browserType, profileName) =>
    ipcRenderer.invoke('add-profile', { browserType, profileName }),
  deleteProfile: (profileId) => ipcRenderer.invoke('delete-profile', profileId),
  launchBrowser: (profileId) => ipcRenderer.invoke('launch-browser', profileId),
  renameProfile: (profileId, newName) =>
    ipcRenderer.invoke('rename-profile', { profileId, newName }),
  openProfileFolder: (profileId) => ipcRenderer.invoke('open-profile-folder', profileId)
});