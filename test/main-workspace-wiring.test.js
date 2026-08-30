const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function loadMainWithFakes() {
  const handlers = new Map();
  const serviceOptions = {};
  const originalLoad = Module._load;
  class FakeStore {
    constructor({ defaults }) {
      this.data = structuredClone(defaults);
    }

    get store() {
      return structuredClone(this.data);
    }

    set store(value) {
      this.data = structuredClone(value);
    }

    get(key) {
      return structuredClone(this.data[key]);
    }

    set(key, value) {
      this.data[key] = structuredClone(value);
    }
  }
  const electron = {
    app: {
      whenReady: () => new Promise(() => {}),
      on() {},
      getPath: () => path.resolve(path.sep, 'app-data'),
    },
    BrowserWindow: {
      getAllWindows: () => [],
    },
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    dialog: {},
    shell: {},
  };
  const mainPath = path.join(__dirname, '..', 'main.js');

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === 'electron-store') return FakeStore;
    if (request === './lib/profile-operation-coordinator') {
      return {
        createProfileOperationCoordinator: () => ({ coordinator: true }),
      };
    }
    if (request === './lib/profile-service') {
      return {
        createProfileService(options) {
          serviceOptions.profile = options;
          return {
            list: () => [],
            add: () => {},
            remove: () => {},
            launch: () => {},
            rename: () => {},
            openFolder: () => {},
            cloneBlank: () => {},
            size: () => {},
            exportMetadata: () => {},
            importMetadata: () => {},
            previewImportMetadata: () => {},
            executeImport: () => {},
          };
        },
      };
    }
    if (request === './lib/import-export-service') {
      return {
        createImportExportService(options) {
          serviceOptions.importExport = options;
          serviceOptions.importService = { previewImport: () => {}, executeImport: () => {} };
          return serviceOptions.importService;
        },
      };
    }
    if (request === './lib/workspace-service') {
      return {
        createWorkspaceService(options) {
          serviceOptions.workspace = options;
          return {
            list: () => [],
            create: () => {},
            rename: () => {},
            remove: () => {},
            assign: () => {},
            setFavorite: () => {},
          };
        },
      };
    }
    if (request === './lib/diagnostics-service') {
      return {
        createDiagnosticsService(options) {
          serviceOptions.diagnostics = options;
          return {
            inspect: () => ({ code: 'HEALTHY', state: 'healthy', actions: [] }),
            repairMissingDirectory: () => ({ success: false, code: 'DIRECTORY_PRESENT' }),
          };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(mainPath)];
    require(mainPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(mainPath)];
  }
  return { handlers, serviceOptions };
}

test('main constructs the workspace service and injects it into IPC registration', async () => {
  const { handlers } = loadMainWithFakes();

  assert.deepEqual(await handlers.get('get-workspaces')({}, undefined), []);
});

test('main injects one shared profile-operation coordinator into profile and workspace services', () => {
  const { serviceOptions } = loadMainWithFakes();

  assert.equal(serviceOptions.workspace.profileOperations, serviceOptions.profile.profileOperations);
});

test('main constructs the import service with safe directory primitives and gives it to profile service', () => {
  const { serviceOptions } = loadMainWithFakes();

  assert.equal(serviceOptions.importExport.profileOperations, serviceOptions.profile.profileOperations);
  assert.equal(typeof serviceOptions.importExport.getProfilePath, 'function');
  assert.equal(typeof serviceOptions.importExport.createEmptyProfileDir, 'function');
  assert.equal(typeof serviceOptions.importExport.removeEmptyDirectory, 'function');
  assert.equal(serviceOptions.profile.importExportService, serviceOptions.importService);
});

test('main constructs diagnostics with the shared profile coordinator and injects it into IPC', async () => {
  const { handlers, serviceOptions } = loadMainWithFakes();

  assert.equal(serviceOptions.diagnostics.profileOperations, serviceOptions.profile.profileOperations);
  assert.equal(typeof serviceOptions.diagnostics.getProfilesDir, 'function');
  assert.equal(typeof serviceOptions.diagnostics.createEmptyProfileDir, 'function');
  assert.deepEqual(await handlers.get('inspect-profile-diagnostics')({}, 'profile-1'), {
    code: 'HEALTHY', state: 'healthy', actions: [],
  });
});
