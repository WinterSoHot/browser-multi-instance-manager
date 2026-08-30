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
          invoke(channel, payload) {
            invocations.push({ channel, payload });
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
    { channel: 'get-workspaces' },
    { channel: 'create-workspace', payload: { name: 'Work' } },
    { channel: 'rename-workspace', payload: { workspaceId: 'workspace-1', name: 'Projects' } },
    { channel: 'delete-workspace', payload: { workspaceId: 'workspace-1' } },
    {
      channel: 'assign-profile-workspace',
      payload: { profileId: 'profile-1', workspaceId: null },
    },
    {
      channel: 'set-profile-favorite',
      payload: { profileId: 'profile-1', favorite: true },
    },
  ]);
});
