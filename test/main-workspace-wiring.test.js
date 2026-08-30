const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function loadMainWithFakes() {
  const handlers = new Map();
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
      getPath: () => '/app-data',
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
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(mainPath)];
    require(mainPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(mainPath)];
  }
  return handlers;
}

test('main constructs the workspace service and injects it into IPC registration', () => {
  const handlers = loadMainWithFakes();

  assert.deepEqual(handlers.get('get-workspaces')({}, undefined), []);
});
