const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBrowserApi() {
  let browserApi;
  const invocations = [];
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  vm.runInNewContext(source, {
    require(moduleName) {
      assert.equal(moduleName, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, 'browserAPI');
            browserApi = api;
          },
        },
        ipcRenderer: {
          invoke(channel, ...args) {
            invocations.push({ channel, args });
            return Promise.resolve({ success: true });
          },
          on() {},
          removeListener() {},
        },
      };
    },
  });
  return { browserApi, invocations };
}

test('preload exposes narrow workspace and favorite APIs with their intended payloads', async () => {
  const { browserApi, invocations } = loadBrowserApi();

  await browserApi.getWorkspaces();
  await browserApi.createWorkspace('Work');
  await browserApi.renameWorkspace('workspace-1', 'Projects');
  await browserApi.deleteWorkspace('workspace-1');
  await browserApi.assignProfileWorkspace('profile-1', null);
  await browserApi.setProfileFavorite('profile-1', true);

  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    { channel: 'get-workspaces', args: [] },
    { channel: 'create-workspace', args: [{ name: 'Work' }] },
    { channel: 'rename-workspace', args: [{ workspaceId: 'workspace-1', name: 'Projects' }] },
    { channel: 'delete-workspace', args: [{ workspaceId: 'workspace-1' }] },
    {
      channel: 'assign-profile-workspace',
      args: [{ profileId: 'profile-1', workspaceId: null }],
    },
    {
      channel: 'set-profile-favorite',
      args: [{ profileId: 'profile-1', favorite: true }],
    },
  ]);
});

test('preload forwards optional forced browser-status snapshots while retaining array calls', async () => {
  const { browserApi, invocations } = loadBrowserApi();

  await browserApi.getBrowserStatuses(['profile-1']);
  await browserApi.getBrowserStatuses(['profile-2'], { force: true });

  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    { channel: 'get-browser-statuses', args: [['profile-1']] },
    { channel: 'get-browser-statuses', args: [['profile-2'], { force: true }] },
  ]);
});

test('preload exposes only the two-phase import calls', async () => {
  const { browserApi, invocations } = loadBrowserApi();

  await browserApi.previewImport();
  await browserApi.executeImport('a'.repeat(64), [{ line: 2, action: 'skip' }]);

  assert.deepEqual(JSON.parse(JSON.stringify(invocations)), [
    { channel: 'preview-import', args: [] },
    {
      channel: 'execute-import',
      args: [{ token: 'a'.repeat(64), decisions: [{ line: 2, action: 'skip' }] }],
    },
  ]);
});
