const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');

function waitForMainTurn() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

async function loadMain({ profiles = [], platform = process.platform } = {}) {
  const originalLoad = Module._load;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const mainPath = path.join(__dirname, '..', 'main.js');
  const windows = [];
  const dialogCalls = [];
  const iconPaths = [];

  class FakeApp extends EventEmitter {
    whenReady() { return Promise.resolve(); }
    getPath() { return path.join(path.sep, 'app-data'); }
    quit() { this.emit('before-quit', { preventDefault() {} }); }
  }

  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.showCalls = 0;
      this.focusCalls = 0;
      windows.push(this);
      this.webContents = { send() {} };
    }

    loadFile() {}
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() {}
    show() { this.showCalls += 1; }
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
    ipcMain: { handle() {}, removeHandler() {} },
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
    getAppSettings: () => ({ closeToTray: true }),
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
  return { app, windows, dialogCalls, iconPaths };
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
  const harness = await loadMain();

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
