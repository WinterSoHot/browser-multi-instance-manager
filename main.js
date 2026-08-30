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
const { createAppStore } = require("./lib/app-store");
const { createProfileService } = require("./lib/profile-service");
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
  filterRestorableProcessRecords,
  validateBrowserSettings,
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
const appStore = createAppStore(store);
const profileOperations = createProfileOperationCoordinator();
const enqueueSettingsMutation = createAsyncQueue();

let mainWindow;
const browserProcessManager = new BrowserProcessManager({
  verifyProcess: inspectBrowserProcess,
  verifyProcesses: inspectBrowserProcesses,
  terminateLaunchedProcess: terminateLaunchedProcessTree,
  onStateChange(records) {
    appStore.setRunningProcesses(records);
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

const profileService = createProfileService({
  appStore,
  profileOperations,
  browserProcessManager,
  getBrowserExecutable,
  getProfilesDir,
  createProfileDir,
  pathExists,
  getDirectorySize,
  renameDirectory: fsp.rename,
  trashItem: shell.trashItem,
  openPath: shell.openPath,
  showSaveDialog: (options) => dialog.showSaveDialog(mainWindow, options),
  showOpenDialog: (options) => dialog.showOpenDialog(mainWindow, options),
  readImportFile: readTextFileBounded,
  writeExportFile: (filePath, content) => fsp.writeFile(filePath, content, "utf8"),
});

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
ipcMain.handle("get-profiles", () => profileService.list());

ipcMain.handle("add-profile", (event, payload) => profileService.add(payload));

ipcMain.handle("delete-profile", (event, payload) => profileService.remove(payload));

ipcMain.handle("launch-browser", (event, profileId) => profileService.launch(profileId));

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

ipcMain.handle("rename-profile", (event, payload) => profileService.rename(payload));

ipcMain.handle("open-profile-folder", (event, profileId) => profileService.openFolder(profileId));

ipcMain.handle("clone-profile", (event, profileId) => profileService.cloneBlank(profileId));

ipcMain.handle("get-profile-size", (event, profileId) => profileService.size(profileId));

ipcMain.handle("export-profiles", () => profileService.exportMetadata());

ipcMain.handle("import-profiles", () => profileService.importMetadata());

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
    appStore.getProfiles(),
    appStore.getRunningProcesses(),
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
