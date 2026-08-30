const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
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
const { createAppSettingsService } = require("./lib/app-settings-service");
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
const { createAppLifecycle } = require("./lib/app-lifecycle");
const { createTrayManager } = require("./lib/tray-manager");
const { createGithubReleaseClient } = require("./lib/github-release-client");
const {
  createUpdateChecker,
  parseSemver,
  sanitizeUpdateResult,
} = require("./lib/update-checker");
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
    appSettings: { closeToTray: true, checkUpdatesOnStartup: true },
    updateCheckCache: null,
  },
});
const appStore = createAppStore(store);
const profileOperations = createProfileOperationCoordinator();
const enqueueSettingsMutation = createAsyncQueue();

let mainWindow;
let trayManager;
let automaticUpdateCheckStarted = false;
let latestAutomaticUpdateResult = null;
let dismissedAutomaticUpdateVersion = null;
let updateHomeContext = null;
let updateHomeNavigationGeneration = 0;
const currentAppVersion = typeof app.getVersion === "function" ? app.getVersion() : "0.0.0";
const homePageUrl = pathToFileURL(path.join(__dirname, "renderer", "index.html")).href;
const updateChecker = createUpdateChecker({
  currentVersion: currentAppVersion,
  requestLatestRelease: createGithubReleaseClient(),
  cache: {
    get: () => appStore.getUpdateCheckCache(),
    set: (cache) => appStore.setUpdateCheckCache(cache),
  },
});

function isCurrentHomeWebContents(webContents) {
  return Boolean(mainWindow && !mainWindow.isDestroyed()
    && mainWindow.webContents === webContents && webContents && !webContents.isDestroyed?.());
}

function isCurrentHomeFrame(event) {
  const webContents = event?.sender;
  const frame = event?.senderFrame;
  return isCurrentHomeWebContents(webContents)
    && webContents.mainFrame === frame
    && frame?.url === homePageUrl;
}

function getAvailableUpdateVersion(result) {
  const update = result?.status === "cached" ? result.result : result;
  if (update?.status !== "available" || !parseSemver(update.version)) return null;
  return update.version;
}

function isDismissedAutomaticUpdate(result) {
  const version = getAvailableUpdateVersion(result);
  return Boolean(version && dismissedAutomaticUpdateVersion === version);
}

function replayAutomaticUpdateResult() {
  if (!latestAutomaticUpdateResult || isDismissedAutomaticUpdate(latestAutomaticUpdateResult)) return;
  const context = updateHomeContext;
  if (!context || context.generation !== updateHomeNavigationGeneration
    || !isCurrentHomeWebContents(context.webContents)
    || context.webContents.mainFrame !== context.frame
    || context.frame?.url !== homePageUrl) return;
  try {
    context.webContents.send("update-check-result", latestAutomaticUpdateResult);
  } catch {
    updateHomeContext = null;
  }
}

ipcMain.handle("update-page-ready", (event) => {
  if (!isCurrentHomeFrame(event)) return { success: false };
  updateHomeContext = {
    webContents: event.sender,
    frame: event.senderFrame,
    generation: updateHomeNavigationGeneration,
  };
  replayAutomaticUpdateResult();
  return { success: true };
});

ipcMain.handle("dismiss-update-notice", (event) => {
  if (!isCurrentHomeFrame(event)) return { success: false };
  const version = getAvailableUpdateVersion(latestAutomaticUpdateResult);
  if (!version) return { success: false };
  dismissedAutomaticUpdateVersion = version;
  return { success: true };
});
const browserProcessManager = new BrowserProcessManager({
  verifyProcess: inspectBrowserProcess,
  verifyProcesses: inspectBrowserProcesses,
  terminateLaunchedProcess: terminateLaunchedProcessTree,
  onStateChange(records) {
    appStore.setRunningProcesses(records);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("browser-statuses-changed");
    }
    trayManager?.scheduleRefresh();
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

const appSettingsService = createAppSettingsService({
  appStore,
  enqueueMutation: enqueueSettingsMutation,
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
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (typeof window.webContents.once === "function") {
    window.webContents.once("did-finish-load", () => {
      if (automaticUpdateCheckStarted) return;
      automaticUpdateCheckStarted = true;
      let enabled = false;
      try {
        enabled = appStore.getAppSettings().checkUpdatesOnStartup !== false;
      } catch {
        return;
      }
      if (!enabled) return;
      void Promise.resolve(updateChecker.check({ force: false })).then((result) => {
        const safeResult = sanitizeUpdateResult(result, currentAppVersion);
        latestAutomaticUpdateResult = safeResult;
        replayAutomaticUpdateResult();
      }).catch(() => {});
    });
  }
  window.webContents.on?.("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame !== true) return;
    updateHomeNavigationGeneration += 1;
    if (updateHomeContext?.webContents === window.webContents) updateHomeContext = null;
  });
  window.on("close", (event) => {
    void appLifecycle.handleWindowClose(event);
  });
  window.on("closed", () => {
    if (updateHomeContext?.webContents === window.webContents) updateHomeContext = null;
    if (mainWindow === window) mainWindow = undefined;
  });
  return window;
}

const unregisterIpcHandlers = registerIpcHandlers({
  ipcMain,
  profileService,
  browserProcessManager,
  settingsService,
  appSettingsService,
  workspaceService,
  diagnosticsService,
  updateChecker,
  appVersion: currentAppVersion,
  openExternal: shell.openExternal,
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

async function showMainWindow() {
  await ensureMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showMainWindowFromAppEvent() {
  void showMainWindow().catch(() => {});
}

function createTrayIcon() {
  const iconName = process.platform === "darwin" ? "trayTemplate.png" : "trayIcon.png";
  const icon = nativeImage.createFromPath(path.join(__dirname, "build", "icons", iconName));
  if (process.platform !== "darwin" || icon.isEmpty()) return icon;
  const trayIcon = icon.resize({ width: 16, height: 16 });
  trayIcon.setTemplateImage(true);
  return trayIcon;
}

async function getActiveStatusCount() {
  const profileIds = appStore.getProfiles().map((profile) => profile.id);
  const statuses = await browserProcessManager.getStatuses(profileIds, { force: true });
  if (!statuses || typeof statuses !== "object") {
    throw new Error("Unable to inspect browser statuses");
  }
  return profileIds.reduce((counts, profileId) => {
    const status = statuses[profileId];
    if (!status || typeof status.running !== "boolean" || status.verificationUnavailable === true) {
      counts.unknown += 1;
    } else if (status.running) {
      counts.running += 1;
    }
    return counts;
  }, { running: 0, unknown: 0 });
}

const appLifecycle = createAppLifecycle({
  platform: process.platform,
  getCloseToTray: () => appStore.getAppSettings().closeToTray !== false,
  getActiveStatusCount,
  confirmExit: async ({ running, unknown }) => {
    const options = {
      type: "warning",
      buttons: ["取消", "退出管理器"],
      defaultId: 0,
      cancelId: 0,
      message: `有 ${running} 个正在运行的浏览器，${unknown} 个状态未知。`,
      detail: "只退出管理器，不关闭浏览器。",
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    return result.response === 1;
  },
  hideWindow: () => mainWindow?.hide(),
  destroyTray: () => trayManager?.destroy(),
  quitApp: () => app.quit(),
});

trayManager = createTrayManager({
  Tray,
  Menu,
  createTrayIcon,
  showWindow: showMainWindow,
  requestQuit: appLifecycle.requestQuit,
  listProfiles: () => appStore.getProfiles(),
  listFavoriteProfiles: () => appStore.getProfiles().filter((profile) => profile.favorite),
  listWorkspaces: () => appStore.getWorkspaces(),
  getStatuses: (profileIds, options) => browserProcessManager.getStatuses(profileIds, options),
  launchProfiles: (profileId) => profileService.launch(profileId),
});

if (typeof store.onDidAnyChange === "function") {
  store.onDidAnyChange(() => trayManager?.scheduleRefresh());
}

void initializationPromise.then(() => trayManager.create()).catch(() => {});
showMainWindowFromAppEvent();

app.on("activate", () => {
  showMainWindowFromAppEvent();
});

app.on("before-quit", (event) => {
  void appLifecycle.handleBeforeQuit(event);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void appLifecycle.requestQuit();
  }
});
