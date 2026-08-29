const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
const { normalizeBrowserExecutablePath } = require("./lib/browser-paths");
const { BrowserProcessManager } = require("./lib/browser-process-manager");
const {
  inspectBrowserProcess,
} = require("./lib/process-inspector");
const { createWindowAfterInitialization } = require("./lib/window-lifecycle");
const {
  areProfileNamesEqual,
  createProfileRecord,
  filterRestorableProcessRecords,
  isStoredProfilePathSafe,
  resolveProfilePath,
  validateBrowserSettings,
  validateProfileInput,
} = require("./lib/profile-utils");

// Initialize store
const store = new Store({
  name: "browser-profiles",
  defaults: {
    profiles: [],
    browserSettings: {},
    runningBrowserProcesses: [],
  },
});

let mainWindow;
const browserProcessManager = new BrowserProcessManager({
  verifyProcess: inspectBrowserProcess,
  onStateChange(records) {
    store.set("runningBrowserProcesses", records);
  },
});

// Get current platform
function getPlatform() {
  return process.platform;
}

// Get default browser paths based on platform
function getDefaultBrowserPaths() {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";

  const paths = {
    chrome: isMac
      ? "/Applications/Google Chrome.app"
      : isWin
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "",
    firefox: isMac
      ? "/Applications/Firefox.app"
      : isWin
        ? "C:\\Program Files\\Mozilla Firefox\\firefox.exe"
        : "",
    edge: isMac
      ? "/Applications/Microsoft Edge.app"
      : isWin
        ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
        : "",
    zen: isMac
      ? "/Applications/Zen.app"
      : isWin
        ? "C:\\Program Files\\Zen Browser\\zen.exe"
        : "",
  };

  return paths;
}

// Get browser executable path based on platform and browser type
function getBrowserExecutable(browserType) {
  const customSettings = store.get("browserSettings", {});
  const customPath = customSettings[browserType];

  // If custom path is set, use it
  if (customPath) {
    try {
      const validatedPath = validateBrowserSettings({ [browserType]: customPath })[browserType];
      return normalizeBrowserExecutablePath(browserType, validatedPath);
    } catch {
      return null;
    }
  }

  // Use default paths
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";

  const defaultExecutables = {
    chrome: isMac
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : isWin
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "",
    firefox: isMac
      ? "/Applications/Firefox.app/Contents/MacOS/firefox"
      : isWin
        ? "C:\\Program Files\\Mozilla Firefox\\firefox.exe"
        : "",
    edge: isMac
      ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      : isWin
        ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
        : "",
    zen: isMac
      ? "/Applications/Zen.app/Contents/MacOS/zen"
      : isWin
        ? "C:\\Program Files\\Zen Browser\\zen.exe"
        : "",
  };

  return defaultExecutables[browserType] || null;
}

function getProfilesDir() {
  const profilesDir = path.join(app.getPath("userData"), "profiles");
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }
  return profilesDir;
}

// Create profile directory
function createProfileDir(browserType, profileName) {
  const profilesDir = getProfilesDir();
  const browserDir = path.join(profilesDir, browserType);
  const profileDir = resolveProfilePath(profilesDir, browserType, profileName);

  if (!fs.existsSync(browserDir)) {
    fs.mkdirSync(browserDir, { recursive: true });
  }

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  return profileDir;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// IPC Handlers
ipcMain.handle("get-profiles", () => {
  return store.get("profiles", []);
});

ipcMain.handle("add-profile", (event, payload = {}) => {
  const { browserType, profileName } = payload;
  try {
    validateProfileInput(browserType, profileName);
  } catch (error) {
    return { success: false, error: error.message };
  }

  const profiles = store.get("profiles", []);
  // Check if profile name already exists
  if (profiles.some((p) => areProfileNamesEqual(p.name, profileName))) {
    return { success: false, error: "Profile name already exists" };
  }

  const profilePath = createProfileDir(browserType, profileName);

  const newProfile = createProfileRecord({
    browserType,
    profileName,
    profilePath,
  });

  profiles.push(newProfile);
  store.set("profiles", profiles);

  return { success: true, profile: newProfile };
});

ipcMain.handle("delete-profile", async (event, profileId) => {
  const profiles = store.get("profiles", []);
  if (!profiles.some((profile) => profile.id === profileId)) {
    return { success: false, error: "Profile not found" };
  }
  const { running } = await browserProcessManager.getStatus(profileId, { force: true });
  if (running) {
    return { success: false, error: "Close the browser before removing its profile" };
  }

  const filteredProfiles = profiles.filter((p) => p.id !== profileId);
  store.set("profiles", filteredProfiles);
  return { success: true };
});

ipcMain.handle("launch-browser", async (event, profileId) => {
  const profiles = store.get("profiles", []);
  const profile = profiles.find((p) => p.id === profileId);

  if (!profile) {
    return { success: false, error: "Profile not found" };
  }

  if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
    return { success: false, error: "Profile path is invalid" };
  }

  const executablePath = getBrowserExecutable(profile.browserType);
  if (!executablePath || !fs.existsSync(executablePath)) {
    return {
      success: false,
      error: `${profile.browserType} not found at ${executablePath}`,
    };
  }

  return browserProcessManager.launch({
    profileId,
    browserType: profile.browserType,
    profilePath: profile.path,
    executablePath,
  });
});

ipcMain.handle("close-browser", async (event, profileId) => {
  return browserProcessManager.close(profileId);
});

ipcMain.handle("get-browser-status", (event, profileId) => {
  return browserProcessManager.getStatus(profileId);
});

ipcMain.handle("rename-profile", async (event, payload = {}) => {
  const { profileId, newName } = payload;
  const profiles = store.get("profiles", []);
  const profileIndex = profiles.findIndex((p) => p.id === profileId);
  if (profileIndex === -1) {
    return { success: false, error: "Profile not found" };
  }
  const { running } = await browserProcessManager.getStatus(profileId, { force: true });
  if (running) {
    return { success: false, error: "Close the browser before renaming its profile" };
  }

  const profile = profiles[profileIndex];
  try {
    validateProfileInput(profile.browserType, newName);
  } catch (error) {
    return { success: false, error: error.message };
  }

  // Check if new name already exists after validating the payload.
  if (profiles.some((p) => p.id !== profileId && areProfileNamesEqual(p.name, newName))) {
    return { success: false, error: "Profile name already exists" };
  }

  if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
    return { success: false, error: "Profile path is invalid" };
  }

  const oldPath = profile.path;
  const newPath = resolveProfilePath(getProfilesDir(), profile.browserType, newName);

  // Rename directory on filesystem
  if (fs.existsSync(oldPath)) {
    try {
      fs.renameSync(oldPath, newPath);
    } catch (error) {
      return {
        success: false,
        error: "Failed to rename directory: " + error.message,
      };
    }
  }

  profile.name = newName;
  profile.path = newPath;
  store.set("profiles", profiles);

  return { success: true, profile: profile };
});

ipcMain.handle("open-profile-folder", async (event, profileId) => {
  const profiles = store.get("profiles", []);
  const profile = profiles.find((p) => p.id === profileId);

  if (!profile) {
    return { success: false, error: "Profile not found" };
  }

  if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
    return { success: false, error: "Profile path is invalid" };
  }

  if (!fs.existsSync(profile.path)) {
    return { success: false, error: "Profile folder not found" };
  }

  const errorMessage = await shell.openPath(profile.path);
  if (errorMessage) {
    return { success: false, error: errorMessage };
  }
  return { success: true };
});

// New IPC handlers for browser settings
ipcMain.handle("get-browser-settings", () => {
  return store.get("browserSettings", {});
});

ipcMain.handle("set-browser-settings", (event, settings) => {
  try {
    const validatedSettings = validateBrowserSettings(settings);
    store.set("browserSettings", validatedSettings);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-default-browser-path", (event, browserType) => {
  const defaultPaths = getDefaultBrowserPaths();
  return defaultPaths[browserType] || "";
});

ipcMain.handle("get-platform", () => {
  return getPlatform();
});

ipcMain.handle("browse-folder", async (event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    defaultPath: defaultPath || undefined,
    filters: [
      { name: "Executables", extensions: ["exe", "app", ""] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, path: null };
  }

  return { success: true, path: result.filePaths[0] };
});

const initializationPromise = app.whenReady().then(async () => {
  const profilesDir = getProfilesDir();
  const persistedProcesses = filterRestorableProcessRecords(
    profilesDir,
    store.get("profiles", []),
    store.get("runningBrowserProcesses", []),
  );
  await browserProcessManager.restore(persistedProcesses);
});

function ensureMainWindow() {
  return createWindowAfterInitialization({
    initializationPromise,
    getWindows: () => BrowserWindow.getAllWindows(),
    createWindow,
  });
}

void ensureMainWindow();

app.on("activate", () => {
  void ensureMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
