const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const fsp = fs.promises;
const Store = require("electron-store");
const {
  normalizeBrowserExecutablePath,
  resolveInstalledBrowserPath,
} = require("./lib/browser-paths");
const { BrowserProcessManager } = require("./lib/browser-process-manager");
const { createAsyncQueue } = require("./lib/async-queue");
const { createAppStore } = require("./lib/app-store");
const { createBrowserSettingsService } = require("./lib/browser-settings-service");
const { createProfileService } = require("./lib/profile-service");
const { createImportExportService } = require("./lib/import-export-service");
const { createWorkspaceService } = require("./lib/workspace-service");
const { createDiagnosticsService } = require("./lib/diagnostics-service");
const {
  createProfileOperationCoordinator,
} = require("./lib/profile-operation-coordinator");
const { terminateLaunchedProcessTree } = require("./lib/process-terminator");
const { readTextFileBounded } = require("./lib/import-reader");
const { registerIpcHandlers } = require("./lib/ipc-handlers");
const {
  inspectBrowserProcess,
  inspectBrowserProcesses,
} = require("./lib/process-inspector");
const { createWindowAfterInitialization } = require("./lib/window-lifecycle");
const {
  filterRestorableProcessRecords,
  resolveProfilePath,
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

function getProfilesDir() {
  return path.join(app.getPath("userData"), "profiles");
}

function getProfilePath(browserType, profileName) {
  return resolveProfilePath(getProfilesDir(), browserType, profileName);
}

// Create profile directory
async function createProfileDir(browserType, profileName) {
  const profileDir = resolveProfilePath(getProfilesDir(), browserType, profileName);
  await fsp.mkdir(profileDir, { recursive: true });
  return profileDir;
}

async function createEmptyProfileDir(browserType, profileName) {
  const profileDir = resolveProfilePath(getProfilesDir(), browserType, profileName);
  await fsp.mkdir(path.dirname(profileDir), { recursive: true });
  await fsp.mkdir(profileDir);
  return profileDir;
}

async function removeEmptyDirectory(directoryPath) {
  await fsp.rmdir(directoryPath);
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

const settingsService = createBrowserSettingsService({
  appStore,
  enqueueMutation: enqueueSettingsMutation,
  normalizeExecutablePath: normalizeBrowserExecutablePath,
  resolveInstalledPath: resolveInstalledBrowserPath,
  validateSettings: validateBrowserSettings,
  pathExists,
  getPlatform: () => process.platform,
  showOpenDialog: (options) => dialog.showOpenDialog(mainWindow, options),
});

const importExportService = createImportExportService({
  appStore,
  profileOperations,
  getProfilePath,
  createEmptyProfileDir,
  removeEmptyDirectory,
  now: () => Date.now(),
});

const profileService = createProfileService({
  appStore,
  profileOperations,
  browserProcessManager,
  getBrowserExecutable: settingsService.getExecutable,
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
  importExportService,
});

const workspaceService = createWorkspaceService({
  appStore,
  profileOperations,
  randomUUID,
  now: () => new Date().toISOString(),
});

const diagnosticsService = createDiagnosticsService({
  appStore,
  profileOperations,
  browserProcessManager,
  getBrowserExecutable: settingsService.getExecutable,
  getProfilesDir,
  pathExists,
  createEmptyProfileDir,
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

const unregisterIpcHandlers = registerIpcHandlers({
  ipcMain,
  profileService,
  browserProcessManager,
  settingsService,
  workspaceService,
  diagnosticsService,
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
