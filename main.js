const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const Store = require("electron-store");
const {
  normalizeBrowserExecutablePath,
  resolveInstalledBrowserPath,
} = require("./lib/browser-paths");
const { BrowserProcessManager } = require("./lib/browser-process-manager");
const { createAsyncQueue } = require("./lib/async-queue");
const {
  createProfileOperationCoordinator,
} = require("./lib/profile-operation-coordinator");
const { terminateLaunchedProcessTree } = require("./lib/process-terminator");
const { readTextFileBounded } = require("./lib/import-reader");
const {
  validateProfileId,
  validateProfileIds,
} = require("./lib/ipc-validation");
const {
  inspectBrowserProcess,
  inspectBrowserProcesses,
} = require("./lib/process-inspector");
const { createWindowAfterInitialization } = require("./lib/window-lifecycle");
const {
  createCloneProfileName,
  createProfileExport,
  createProfileRecord,
  filterRestorableProcessRecords,
  isDuplicateProfileName,
  isStoredProfilePathSafe,
  resolveProfilePath,
  validateBrowserSettings,
  validateProfileImportDocument,
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
const profileOperations = createProfileOperationCoordinator();
const enqueueSettingsMutation = createAsyncQueue();

let mainWindow;
const browserProcessManager = new BrowserProcessManager({
  verifyProcess: inspectBrowserProcess,
  verifyProcesses: inspectBrowserProcesses,
  terminateLaunchedProcess: terminateLaunchedProcessTree,
  onStateChange(records) {
    store.set("runningBrowserProcesses", records);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("browser-statuses-changed");
    }
  },
});

// Get current platform
function getPlatform() {
  return process.platform;
}

// Get default browser paths based on platform
function getDefaultBrowserPaths() {
  return Object.fromEntries(
    ["chrome", "firefox", "edge", "zen"].map((browserType) => [
      browserType,
      resolveInstalledBrowserPath(browserType),
    ]),
  );
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

  const detectedPath = resolveInstalledBrowserPath(browserType);
  return detectedPath
    ? normalizeBrowserExecutablePath(browserType, detectedPath)
    : null;
}

function getProfilesDir() {
  return path.join(app.getPath("userData"), "profiles");
}

// Create profile directory
async function createProfileDir(browserType, profileName) {
  const profilesDir = getProfilesDir();
  const profileDir = resolveProfilePath(profilesDir, browserType, profileName);
  await fsp.mkdir(profileDir, { recursive: true });
  return profileDir;
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getDirectorySize(directoryPath) {
  let total = 0;
  const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) total += await getDirectorySize(entryPath);
    else if (entry.isFile()) total += (await fsp.stat(entryPath)).size;
  }
  return total;
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

ipcMain.handle("add-profile", (event, payload = {}) => profileOperations.runGlobalMutation(async () => {
  const { browserType, profileName } = payload;
  try {
    validateProfileInput(browserType, profileName);
  } catch (error) {
    return { success: false, error: error.message };
  }

  const profiles = store.get("profiles", []);
  // Check if profile name already exists
  if (isDuplicateProfileName(profiles, browserType, profileName)) {
    return { success: false, error: "Profile name already exists" };
  }

  const profilePath = await createProfileDir(browserType, profileName);

  const newProfile = createProfileRecord({
    browserType,
    profileName,
    profilePath,
  });

  profiles.push(newProfile);
  store.set("profiles", profiles);

  return { success: true, profile: newProfile };
}));

ipcMain.handle("delete-profile", (event, payload) => {
  const { profileId, trashData = false } = typeof payload === "string"
    ? { profileId: payload }
    : (payload || {});
  return profileOperations.runMutation(profileId, async () => {
    const profiles = store.get("profiles", []);
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      return { success: false, error: "Profile not found" };
    }
    const { running } = await browserProcessManager.getStatus(profileId, { force: true });
    if (running) {
      return { success: false, error: "Close the browser before removing its profile" };
    }

    if (trashData) {
      if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
        return { success: false, error: "Profile path is invalid" };
      }
      if (await pathExists(profile.path)) await shell.trashItem(profile.path);
    }

    const filteredProfiles = profiles.filter((p) => p.id !== profileId);
    store.set("profiles", filteredProfiles);
    return { success: true };
  });
});

ipcMain.handle("launch-browser", (event, profileId) => profileOperations.runLifecycle(
  profileId,
  async () => {
    const profiles = store.get("profiles", []);
    const profile = profiles.find((p) => p.id === profileId);

    if (!profile) {
      return { success: false, error: "Profile not found" };
    }

    if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
      return { success: false, error: "Profile path is invalid" };
    }

    const executablePath = getBrowserExecutable(profile.browserType);
    if (!executablePath || !(await pathExists(executablePath))) {
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
  },
));

ipcMain.handle("close-browser", async (event, profileId) => {
  return browserProcessManager.close(profileId);
});

ipcMain.handle("get-browser-status", (event, profileId) => {
  return browserProcessManager.getStatus(profileId);
});

ipcMain.handle("get-browser-statuses", (event, profileIds = []) => {
  return browserProcessManager.getStatuses(validateProfileIds(profileIds));
});

ipcMain.handle("refresh-browser-status", (event, profileId) => {
  return browserProcessManager.getStatus(profileId, { force: true });
});

ipcMain.handle("forget-browser-process", (event, payload = {}) => {
  const { profileId, acknowledgePossibleRunning = false } = payload;
  if (typeof acknowledgePossibleRunning !== "boolean") {
    return { success: false, error: "Invalid process record request" };
  }
  try {
    return browserProcessManager.forget(
      validateProfileId(profileId),
      { acknowledgePossibleRunning },
    );
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("rename-profile", (event, payload = {}) => {
  const { profileId, newName } = payload;
  return profileOperations.runMutation(profileId, async () => {
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

    if (isDuplicateProfileName(profiles, profile.browserType, newName, profileId)) {
      return { success: false, error: "Profile name already exists" };
    }

    if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
      return { success: false, error: "Profile path is invalid" };
    }

    const oldPath = profile.path;
    const newPath = resolveProfilePath(getProfilesDir(), profile.browserType, newName);

    if (await pathExists(oldPath)) {
      try {
        await fsp.rename(oldPath, newPath);
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

  if (!(await pathExists(profile.path))) {
    return { success: false, error: "Profile folder not found" };
  }

  const errorMessage = await shell.openPath(profile.path);
  if (errorMessage) {
    return { success: false, error: errorMessage };
  }
  return { success: true };
});

ipcMain.handle("clone-profile", (event, profileId) => profileOperations.runGlobalMutation(async () => {
  const profiles = store.get("profiles", []);
  const source = profiles.find((profile) => profile.id === profileId);
  if (!source) return { success: false, error: "Profile not found" };

  const profileName = createCloneProfileName(profiles, source.browserType, source.name);
  const profilePath = await createProfileDir(source.browserType, profileName);
  const profile = createProfileRecord({
    browserType: source.browserType,
    profileName,
    profilePath,
  });
  profiles.push(profile);
  store.set("profiles", profiles);
  return { success: true, profile };
}));

ipcMain.handle("get-profile-size", async (event, profileId) => {
  const profile = store.get("profiles", []).find((candidate) => candidate.id === profileId);
  if (!profile) return { success: false, error: "Profile not found" };
  if (!isStoredProfilePathSafe(getProfilesDir(), profile)) {
    return { success: false, error: "Profile path is invalid" };
  }
  if (!(await pathExists(profile.path))) return { success: true, bytes: 0 };
  try {
    return { success: true, bytes: await getDirectorySize(profile.path) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("export-profiles", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: "browser-profiles.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { success: false, canceled: true };
  const document = createProfileExport(store.get("profiles", []));
  await fsp.writeFile(result.filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { success: true, count: document.profiles.length };
});

ipcMain.handle("import-profiles", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  try {
    const importPath = result.filePaths[0];
    const document = JSON.parse(await readTextFileBounded(importPath));
    const importedMetadata = validateProfileImportDocument(document);
    return await profileOperations.runGlobalMutation(async () => {
      const profiles = store.get("profiles", []);
      const imported = [];
      let skipped = 0;
      for (const metadata of importedMetadata) {
        if (isDuplicateProfileName(profiles, metadata.browserType, metadata.name)) {
          skipped += 1;
          continue;
        }
        const profilePath = await createProfileDir(metadata.browserType, metadata.name);
        const profile = createProfileRecord({
          browserType: metadata.browserType,
          profileName: metadata.name,
          profilePath,
        });
        profiles.push(profile);
        imported.push(profile);
      }
      store.set("profiles", profiles);
      return { success: true, profiles: imported, skipped };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// New IPC handlers for browser settings
ipcMain.handle("get-browser-settings", () => {
  return store.get("browserSettings", {});
});

ipcMain.handle("set-browser-settings", (event, settings) => enqueueSettingsMutation(async () => {
  try {
    const validatedSettings = validateBrowserSettings(settings);
    for (const [browserType, configuredPath] of Object.entries(validatedSettings)) {
      if (!configuredPath) continue;
      const executablePath = normalizeBrowserExecutablePath(browserType, configuredPath);
      if (!(await pathExists(executablePath))) {
        throw new Error(`${browserType} executable does not exist`);
      }
    }
    store.set("browserSettings", validatedSettings);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}));

ipcMain.handle("get-default-browser-path", (event, browserType) => {
  const defaultPaths = getDefaultBrowserPaths();
  return defaultPaths[browserType] || "";
});

ipcMain.handle("get-platform", () => {
  return getPlatform();
});

ipcMain.handle("get-browser-environment", async () => {
  const settings = store.get("browserSettings", {});
  const defaultPaths = getDefaultBrowserPaths();
  const validity = {};
  for (const browserType of ["chrome", "firefox", "edge", "zen"]) {
    const selectedPath = settings[browserType] || defaultPaths[browserType];
    validity[browserType] = Boolean(
      selectedPath
      && await pathExists(normalizeBrowserExecutablePath(browserType, selectedPath)),
    );
  }
  return { platform: getPlatform(), settings, defaultPaths, validity };
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
  await fsp.mkdir(profilesDir, { recursive: true });
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
