const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const Store = require("electron-store");

// Initialize store
const store = new Store({
  name: "browser-profiles",
  defaults: {
    profiles: [],
    browserSettings: {},
  },
});

let mainWindow;

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
    return customPath;
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

// Launch browser with profile
function launchBrowser(browserType, profilePath) {
  const exePath = getBrowserExecutable(browserType);

  if (!exePath || !fs.existsSync(exePath)) {
    return { success: false, error: `${browserType} not found at ${exePath}` };
  }

  let args = [];

  switch (browserType) {
    case "chrome":
    case "edge":
      args = ["--user-data-dir=" + profilePath];
      break;
    case "firefox":
    case "zen":
      args = ["-profile", profilePath];
      break;
    default:
      return { success: false, error: "Unknown browser type" };
  }

  try {
    spawn(exePath, args, { detached: true, stdio: "ignore" }).unref();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Create profile directory
function createProfileDir(browserType, profileName) {
  const profilesDir = getProfilesDir();
  const browserDir = path.join(profilesDir, browserType);
  const profileDir = path.join(browserDir, profileName);

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
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// IPC Handlers
ipcMain.handle("get-profiles", () => {
  return store.get("profiles", []);
});

ipcMain.handle("add-profile", (event, { browserType, profileName }) => {
  const profiles = store.get("profiles", []);

  // Check if profile name already exists
  if (profiles.some((p) => p.name === profileName)) {
    return { success: false, error: "Profile name already exists" };
  }

  const profilePath = createProfileDir(browserType, profileName);

  const newProfile = {
    id: Date.now().toString(),
    browserType,
    name: profileName,
    path: profilePath,
    createdAt: new Date().toISOString(),
  };

  profiles.push(newProfile);
  store.set("profiles", profiles);

  return { success: true, profile: newProfile };
});

ipcMain.handle("delete-profile", (event, profileId) => {
  const profiles = store.get("profiles", []);
  const filteredProfiles = profiles.filter((p) => p.id !== profileId);
  store.set("profiles", filteredProfiles);
  return { success: true };
});

ipcMain.handle("launch-browser", (event, profileId) => {
  const profiles = store.get("profiles", []);
  const profile = profiles.find((p) => p.id === profileId);

  if (!profile) {
    return { success: false, error: "Profile not found" };
  }

  return launchBrowser(profile.browserType, profile.path);
});

ipcMain.handle("rename-profile", (event, { profileId, newName }) => {
  const profiles = store.get("profiles", []);

  // Check if new name already exists
  if (profiles.some((p) => p.name === newName && p.id !== profileId)) {
    return { success: false, error: "Profile name already exists" };
  }

  const profileIndex = profiles.findIndex((p) => p.id === profileId);
  if (profileIndex === -1) {
    return { success: false, error: "Profile not found" };
  }

  const profile = profiles[profileIndex];
  const oldPath = profile.path;
  const newPath = path.join(path.dirname(oldPath), newName);

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

ipcMain.handle("open-profile-folder", (event, profileId) => {
  const profiles = store.get("profiles", []);
  const profile = profiles.find((p) => p.id === profileId);

  if (!profile) {
    return { success: false, error: "Profile not found" };
  }

  if (!fs.existsSync(profile.path)) {
    return { success: false, error: "Profile folder not found" };
  }

  shell.openPath(profile.path);
  return { success: true };
});

// New IPC handlers for browser settings
ipcMain.handle("get-browser-settings", () => {
  return store.get("browserSettings", {});
});

ipcMain.handle("set-browser-settings", (event, settings) => {
  store.set("browserSettings", settings);
  return { success: true };
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

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
