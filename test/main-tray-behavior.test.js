const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseSemver, sanitizeUpdateResult } = require('../lib/update-checker');

const homePageUrl = pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href;
const settingsPageUrl = pathToFileURL(path.join(__dirname, '..', 'renderer', 'settings.html')).href;

function waitForMainTurn() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

function deferred() {
  let resolve;
  return { promise: new Promise((next) => { resolve = next; }), resolve };
}

function homeReadyEvent(window, frame = window.webContents.mainFrame) {
  return { sender: window.webContents, senderFrame: frame };
}

function navigate(window, url, isMainFrame = true) {
  if (isMainFrame) window.webContents.mainFrame = { url };
  window.webContents.emit('did-start-navigation', {}, url, false, isMainFrame);
}

async function loadMain({
  profiles = [],
  platform = process.platform,
  showError = null,
  appSettings = { closeToTray: true, checkUpdatesOnStartup: true },
  updateResult = { status: 'current' },
} = {}) {
  const originalLoad = Module._load;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const mainPath = path.join(__dirname, '..', 'main.js');
  const windows = [];
  const dialogCalls = [];
  const iconPaths = [];
  const updateChecks = [];
  const sent = [];
  const ipcHandlers = new Map();

  class FakeApp extends EventEmitter {
    whenReady() { return Promise.resolve(); }
    getPath() { return path.join(path.sep, 'app-data'); }
    getVersion() { return '1.3.1'; }
    quit() { this.emit('before-quit', { preventDefault() {} }); }
  }

  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.showCalls = 0;
      this.focusCalls = 0;
      windows.push(this);
      this.webContents = new EventEmitter();
      this.webContents.send = (channel, payload) => sent.push({ channel, payload });
      this.webContents.mainFrame = { url: homePageUrl };
    }

    loadFile() {}
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() {}
    show() {
      this.showCalls += 1;
      if (showError) throw showError;
    }
    focus() { this.focusCalls += 1; }
    hide() {}
    detachWithoutClosedEvent() {
      this.destroyed = true;
      windows.splice(windows.indexOf(this), 1);
    }
    emitClosed() { this.emit('closed'); }
  }
  FakeWindow.getAllWindows = () => [...windows];

  class FakeTray extends EventEmitter {
    setContextMenu() {}
    destroy() {}
  }

  class FakeStore {
    constructor() { this.listeners = []; }
    onDidAnyChange(listener) { this.listeners.push(listener); return () => {}; }
  }

  const app = new FakeApp();
  const electron = {
    app,
    BrowserWindow: FakeWindow,
    ipcMain: {
      handle(channel, handler) { ipcHandlers.set(channel, handler); },
      removeHandler(channel) { ipcHandlers.delete(channel); },
    },
    dialog: {
      async showMessageBox(...args) {
        dialogCalls.push(args);
        return { response: 0 };
      },
    },
    shell: {},
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: {
      createFromPath(iconPath) {
        iconPaths.push(iconPath);
        return {
          isEmpty: () => false,
          resize: () => ({ setTemplateImage() {} }),
        };
      },
    },
  };
  const appStore = {
    getProfiles: () => structuredClone(profiles),
    getRunningProcesses: () => [],
    setRunningProcesses() {},
    getWorkspaces: () => [],
    getAppSettings: () => structuredClone(appSettings),
    getUpdateCheckCache: () => null,
    setUpdateCheckCache() {},
  };
  const emptyService = {
    list: () => [],
    add: () => {},
    remove: () => {},
    launch: async () => ({ success: true }),
    rename: () => {},
    openFolder: () => {},
    cloneBlank: () => {},
    size: () => {},
    exportMetadata: () => {},
    importMetadata: () => {},
    previewImportMetadata: () => {},
    executeImport: () => {},
  };

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === 'electron-store') return FakeStore;
    if (request === 'fs') return { promises: { mkdir: async () => {}, rmdir: async () => {} } };
    if (request === './lib/browser-paths') {
      return { normalizeBrowserExecutablePath: (value) => value, resolveInstalledBrowserPath: () => '' };
    }
    if (request === './lib/browser-process-manager') {
      return {
        BrowserProcessManager: class {
          constructor() {}
          async restore() {}
          async getStatuses(profileIds) {
            return Object.fromEntries(profileIds.map((profileId) => [profileId, { running: true }]));
          }
        },
      };
    }
    if (request === './lib/async-queue') return { createAsyncQueue: () => (task) => task() };
    if (request === './lib/app-store') return { createAppStore: () => appStore };
    if (request === './lib/browser-settings-service') {
      return { createBrowserSettingsService: () => ({ getExecutable: () => '' }) };
    }
    if (request === './lib/app-settings-service') {
      return {
        createAppSettingsService: () => ({
          get: () => ({ closeToTray: true }),
          set: async () => ({ success: true, settings: { closeToTray: true } }),
        }),
      };
    }
    if (request === './lib/profile-service') return { createProfileService: () => emptyService };
    if (request === './lib/import-export-service') {
      return { createImportExportService: () => ({ previewImport: () => {}, executeImport: () => {} }) };
    }
    if (request === './lib/workspace-service') {
      return { createWorkspaceService: () => ({ list: () => [] }) };
    }
    if (request === './lib/diagnostics-service') {
      return { createDiagnosticsService: () => ({ inspect: () => {}, repairMissingDirectory: () => {} }) };
    }
    if (request === './lib/profile-operation-coordinator') {
      return { createProfileOperationCoordinator: () => ({}) };
    }
    if (request === './lib/process-terminator') return { terminateLaunchedProcessTree: () => {} };
    if (request === './lib/import-reader') return { readTextFileBounded: () => {} };
    if (request === './lib/ipc-handlers') return { registerIpcHandlers: () => () => {} };
    if (request === './lib/github-release-client') return { createGithubReleaseClient: () => async () => ({}) };
    if (request === './lib/update-checker') {
      return {
        createUpdateChecker: () => ({
          check(options) {
            updateChecks.push(options);
            return Promise.resolve(updateResult);
          },
        }),
        parseSemver,
        sanitizeUpdateResult,
      };
    }
    if (request === './lib/process-inspector') {
      return { inspectBrowserProcess: () => {}, inspectBrowserProcesses: () => {} };
    }
    if (request === './lib/profile-utils') {
      return {
        filterRestorableProcessRecords: () => [],
        resolveProfilePath: (...segments) => path.join(...segments),
        validateBrowserSettings: (value) => value,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    Object.defineProperty(process, 'platform', { value: platform });
    delete require.cache[require.resolve(mainPath)];
    require(mainPath);
    await waitForMainTurn();
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    Module._load = originalLoad;
    delete require.cache[require.resolve(mainPath)];
  }
  return { app, windows, dialogCalls, iconPaths, sent, updateChecks, ipcHandlers };
}

test('main drops a closed window reference and opens exit confirmation without a destroyed parent', async () => {
  const harness = await loadMain({ profiles: [{ id: 'running-profile' }] });
  const window = harness.windows[0];
  window.detachWithoutClosedEvent();
  window.emitClosed();
  const event = { preventDefault() {} };

  harness.app.emit('before-quit', event);
  await waitForMainTurn();

  assert.equal(harness.dialogCalls.length, 1);
  assert.equal(harness.dialogCalls[0].length, 1);
  assert.equal(harness.dialogCalls[0][0].type, 'warning');
});

test('a delayed closed event for an older window does not detach the newer active window', async () => {
  const harness = await loadMain();
  const first = harness.windows[0];
  first.detachWithoutClosedEvent();
  harness.app.emit('activate');
  await waitForMainTurn();
  const second = harness.windows[0];
  const baselineShowCalls = second.showCalls;

  first.emitClosed();
  harness.app.emit('activate');
  await waitForMainTurn();

  assert.equal(harness.windows[0], second);
  assert.ok(second.showCalls > baselineShowCalls);
});

test('main selects the dedicated tray template asset', async () => {
  const harness = await loadMain({ platform: 'darwin' });

  assert.match(harness.iconPaths[0], /trayTemplate\.png$/u);
});

test('main chooses the template asset only on macOS and a separate icon on Windows and Linux', async () => {
  const mac = await loadMain({ platform: 'darwin' });
  const windows = await loadMain({ platform: 'win32' });
  const linux = await loadMain({ platform: 'linux' });

  assert.match(mac.iconPaths[0], /trayTemplate\.png$/u);
  assert.match(windows.iconPaths[0], /trayIcon\.png$/u);
  assert.match(linux.iconPaths[0], /trayIcon\.png$/u);
});

test('main consumes initial and activate window-show failures', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const harness = await loadMain({ showError: new Error('window unavailable') });
    harness.app.emit('activate');
    await waitForMainTurn();

    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('main starts one automatic check after first did-finish-load and sends a narrowed result', async () => {
  const harness = await loadMain({
    updateResult: { status: 'available', version: '1.4.0', releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0' },
  });
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(harness.windows[0]));
  harness.windows[0].webContents.emit('did-finish-load');
  await waitForMainTurn();
  harness.windows[0].webContents.emit('did-finish-load');
  await waitForMainTurn();

  assert.deepEqual(harness.updateChecks, [{ force: false }]);
  assert.deepEqual(harness.sent, [{
    channel: 'update-check-result',
    payload: { status: 'available', version: '1.4.0', releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0' },
  }]);
});

test('a disabled first startup decision never checks after a recreated window', async () => {
  const harness = await loadMain({
    appSettings: { closeToTray: true, checkUpdatesOnStartup: false },
  });
  const first = harness.windows[0];
  first.webContents.emit('did-finish-load');
  first.detachWithoutClosedEvent();
  first.emitClosed();
  harness.app.emit('activate');
  await waitForMainTurn();
  harness.windows[0].webContents.emit('did-finish-load');
  await waitForMainTurn();

  assert.deepEqual(harness.updateChecks, []);
  assert.deepEqual(harness.sent, []);
});

test('main turns malformed or stale automatic results into a stable error event', async () => {
  const harness = await loadMain({
    updateResult: { status: 'available', version: '1.3.1', releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.3.1' },
  });
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(harness.windows[0]));
  harness.windows[0].webContents.emit('did-finish-load');
  await waitForMainTurn();

  assert.deepEqual(harness.sent, [{
    channel: 'update-check-result',
    payload: { status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED' },
  }]);
});

test('a delayed automatic result is replayed only after returning from settings to a ready home page', async () => {
  const pending = deferred();
  const result = {
    status: 'available',
    version: '1.4.0',
    releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
  };
  const harness = await loadMain({ updateResult: pending.promise });
  const window = harness.windows[0];

  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));
  window.webContents.emit('did-finish-load');
  navigate(window, settingsPageUrl);
  pending.resolve(result);
  await waitForMainTurn();
  assert.deepEqual(harness.sent, []);

  navigate(window, homePageUrl);
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));
  assert.deepEqual(harness.sent, [{ channel: 'update-check-result', payload: result }]);
});

test('a recreated ready home page receives an automatic result that resolves after its handshake', async () => {
  const pending = deferred();
  const result = { status: 'current' };
  const harness = await loadMain({ updateResult: pending.promise });
  const first = harness.windows[0];
  first.webContents.emit('did-finish-load');
  first.detachWithoutClosedEvent();
  first.emitClosed();
  harness.app.emit('activate');
  await waitForMainTurn();
  const second = harness.windows[0];

  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(second));
  pending.resolve(result);
  await waitForMainTurn();
  assert.deepEqual(harness.updateChecks, [{ force: false }]);
  assert.deepEqual(harness.sent, [{ channel: 'update-check-result', payload: result }]);
});

test('a result-first home document receives one automatic result across repeated ready handshakes', async () => {
  const result = { status: 'current' };
  const harness = await loadMain({ updateResult: result });
  const window = harness.windows[0];
  window.webContents.emit('did-finish-load');
  await waitForMainTurn();

  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));

  assert.deepEqual(harness.sent, [{ channel: 'update-check-result', payload: result }]);
});

test('a ready-first home document does not replay the resolved automatic result on a duplicate handshake', async () => {
  const pending = deferred();
  const result = { status: 'current' };
  const harness = await loadMain({ updateResult: pending.promise });
  const window = harness.windows[0];
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));
  window.webContents.emit('did-finish-load');
  pending.resolve(result);
  await waitForMainTurn();

  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));

  assert.deepEqual(harness.sent, [{ channel: 'update-check-result', payload: result }]);
});

test('a returned home document receives the retained automatic result once', async () => {
  const result = { status: 'current' };
  const harness = await loadMain({ updateResult: result });
  const window = harness.windows[0];
  window.webContents.emit('did-finish-load');
  await waitForMainTurn();

  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));
  navigate(window, settingsPageUrl);
  navigate(window, homePageUrl);
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));

  assert.deepEqual(harness.sent, [
    { channel: 'update-check-result', payload: result },
    { channel: 'update-check-result', payload: result },
  ]);
});

test('dismissed automatic version stays hidden across settings navigation and window recreation', async () => {
  const result = {
    status: 'available',
    version: '1.4.0',
    releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
  };
  const harness = await loadMain({ updateResult: result });
  const first = harness.windows[0];
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(first));
  first.webContents.emit('did-finish-load');
  await waitForMainTurn();
  await harness.ipcHandlers.get('dismiss-update-notice')(homeReadyEvent(first));
  navigate(first, settingsPageUrl);
  navigate(first, homePageUrl);
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(first));
  first.detachWithoutClosedEvent();
  first.emitClosed();
  harness.app.emit('activate');
  await waitForMainTurn();
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(harness.windows[0]));

  assert.deepEqual(harness.sent, [{ channel: 'update-check-result', payload: result }]);
});

test('only the current trusted home main frame can mark the update page ready', async () => {
  const pending = deferred();
  const result = { status: 'current' };
  const harness = await loadMain({ updateResult: pending.promise });
  const window = harness.windows[0];
  const oldHomeFrame = window.webContents.mainFrame;
  window.webContents.emit('did-finish-load');
  navigate(window, settingsPageUrl);
  assert.deepEqual(
    await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window)),
    { success: false },
  );
  assert.deepEqual(
    await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window, oldHomeFrame)),
    { success: false },
  );
  pending.resolve(result);
  await waitForMainTurn();
  assert.deepEqual(harness.sent, []);
  navigate(window, homePageUrl);
  assert.deepEqual(
    await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window)),
    { success: true },
  );
  assert.deepEqual(harness.sent, [{ channel: 'update-check-result', payload: result }]);
});

test('a subframe navigation does not clear a ready home update context', async () => {
  const pending = deferred();
  const harness = await loadMain({ updateResult: pending.promise });
  const window = harness.windows[0];
  await harness.ipcHandlers.get('update-page-ready')(homeReadyEvent(window));
  window.webContents.emit('did-finish-load');
  navigate(window, 'file:///untrusted-frame.html', false);
  pending.resolve({ status: 'current' });
  await waitForMainTurn();

  assert.deepEqual(harness.sent, [{ channel: 'update-check-result', payload: { status: 'current' } }]);
});
