# Modular Foundation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split storage, profile operations, IPC registration, and renderer state from the current large entry files without changing user-visible behavior.

**Architecture:** Introduce dependency-injected CommonJS modules and pure migration/state helpers, then make `main.js` a composition root. Preserve the current `electron-store` schema and every existing IPC contract during this phase.

**Tech Stack:** Electron, CommonJS JavaScript, electron-store, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-30-p0-tray-update-refactor-design.md`

## Global Constraints

- Keep macOS and Windows support and add no front-end framework.
- Preserve current process verification, termination, and four-operation concurrency behavior.
- Preserve all existing IPC names and response shapes during refactoring.
- Import/export must still expose only `browserType` and profile name.
- Run the full test suite after every extraction task.

---

### Task 1: Versioned Store Schema

**Files:**
- Create: `lib/app-store.js`
- Create: `test/app-store.test.js`
- Modify: `main.js:28-39`

**Interfaces:**
- Produces: `CURRENT_SCHEMA_VERSION`, `migrateStoreData(input)`, `createAppStore(store)`.
- `createAppStore` exposes `getProfiles()`, `setProfiles(profiles)`, `getBrowserSettings()`, `setBrowserSettings(settings)`, `getRunningProcesses()`, `setRunningProcesses(records)`, `getWorkspaces()`, `setWorkspaces(workspaces)`, `getAppSettings()`, and `setAppSettings(settings)`.

- [ ] **Step 1: Add failing migration and adapter tests**

```js
test('migrates legacy data without changing profile identity or paths', () => {
  const migrated = migrateStoreData({ profiles: [legacyProfile] });
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(migrated.profiles[0], {
    ...legacyProfile,
    workspaceId: null,
    favorite: false,
    lastLaunchedAt: null,
  });
});

test('migration is idempotent', () => {
  const once = migrateStoreData(legacyData);
  assert.deepEqual(migrateStoreData(once), once);
});
```

- [ ] **Step 2: Verify the focused test fails**

Run: `node --test test/app-store.test.js`

Expected: FAIL because `lib/app-store.js` does not exist.

- [ ] **Step 3: Implement the pure migration and narrow adapter**

```js
const CURRENT_SCHEMA_VERSION = 1;

function migrateStoreData(input = {}) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profiles: Array.isArray(input.profiles) ? input.profiles.map((profile) => ({
      ...profile,
      workspaceId: profile.workspaceId ?? null,
      favorite: profile.favorite === true,
      lastLaunchedAt: profile.lastLaunchedAt ?? null,
    })) : [],
    workspaces: Array.isArray(input.workspaces) ? input.workspaces : [],
    browserSettings: input.browserSettings || {},
    runningBrowserProcesses: Array.isArray(input.runningBrowserProcesses)
      ? input.runningBrowserProcesses : [],
    appSettings: input.appSettings || {},
  };
}
```

The adapter must read the full legacy snapshot once, validate the migrated shape, write it only when changed, and clone returned arrays/objects so callers cannot mutate the store accidentally.

- [ ] **Step 4: Replace direct initialization reads with `appStore`**

Create `const appStore = createAppStore(store);`, run migration before process restoration, and route process persistence through `appStore.setRunningProcesses(records)`.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test test/app-store.test.js && npm test`

Expected: all tests pass and legacy profile fields remain unchanged except additive defaults.

- [ ] **Step 6: Commit**

```bash
git add lib/app-store.js test/app-store.test.js main.js
git commit -m "重构存储访问与版本迁移"
```

### Task 2: Profile Service Extraction

**Files:**
- Create: `lib/profile-service.js`
- Create: `test/profile-service.test.js`
- Modify: `main.js:148-422`

**Interfaces:**
- Consumes: `appStore`, `profileOperations`, `browserProcessManager`, filesystem and Electron dialog/shell dependencies.
- Produces: `createProfileService(dependencies)` with `list`, `add`, `remove`, `rename`, `cloneBlank`, `size`, `openFolder`, `launch`, `exportMetadata`, and `importMetadata` methods. `importMetadata` preserves the current one-step import contract in this phase.

- [ ] **Step 1: Add failing tests for preserved profile behavior**

```js
test('add validates and persists one profile', async () => {
  const result = await service.add({ browserType: 'chrome', profileName: 'Work' });
  assert.equal(result.success, true);
  assert.equal(storeState.profiles[0].name, 'Work');
});

test('remove refuses a running profile before trashing data', async () => {
  browserStatus.running = true;
  assert.deepEqual(await service.remove({ profileId: 'p1', trashData: true }), {
    success: false,
    error: 'Close the browser before removing its profile',
  });
  assert.equal(trashCalls.length, 0);
});
```

- [ ] **Step 2: Verify the focused test fails**

Run: `node --test test/profile-service.test.js`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Move profile behavior behind dependency injection**

```js
function createProfileService({
  appStore,
  profileOperations,
  browserProcessManager,
  getBrowserExecutable,
  getProfilesDir,
  createProfileDir,
  pathExists,
  getDirectorySize,
  renameDirectory,
  trashItem,
  openPath,
  showSaveDialog,
  showOpenDialog,
  readImportFile,
  writeExportFile,
}) {
  return {
    list,
    add,
    remove,
    rename,
    cloneBlank,
    size,
    openFolder,
    launch,
    exportMetadata,
    importMetadata,
  };
}
```

Keep the existing validation helpers and exact success/error shapes. Do not move process signaling into this service.

- [ ] **Step 4: Delegate existing IPC bodies to the service**

Each existing handler in `main.js` must become a one-line service call while retaining its current channel name.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test test/profile-service.test.js && npm test`

Expected: all existing profile, import, process, and workflow tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/profile-service.js test/profile-service.test.js main.js
git commit -m "重构配置服务边界"
```

### Task 3: Central IPC Registration

**Files:**
- Create: `lib/ipc-handlers.js`
- Create: `test/ipc-handlers.test.js`
- Modify: `main.js`

**Interfaces:**
- Consumes: `ipcMain`, `profileService`, `browserProcessManager`, browser settings service functions, and dialog helpers.
- Produces: `registerIpcHandlers(dependencies)` returning an `unregister()` function for tests and teardown.

- [ ] **Step 1: Add a failing registration contract test**

```js
test('registers each channel once and unregisters cleanly', () => {
  const unregister = registerIpcHandlers(dependencies);
  assert.equal(handlers.get('get-profiles')({}, undefined).length, 1);
  unregister();
  assert.equal(handlers.size, 0);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/ipc-handlers.test.js`

Expected: FAIL because the registry module is missing.

- [ ] **Step 3: Implement explicit channel registration**

```js
function registerIpcHandlers({ ipcMain, profileService, browserProcessManager, settingsService }) {
  const channels = new Map([
    ['get-profiles', () => profileService.list()],
    ['add-profile', (_event, payload) => profileService.add(payload)],
    ['launch-browser', (_event, profileId) => profileService.launch(profileId)],
    ['close-browser', (_event, profileId) => browserProcessManager.close(profileId)],
  ]);
  for (const [channel, handler] of channels) ipcMain.handle(channel, handler);
  return () => {
    for (const channel of channels.keys()) ipcMain.removeHandler(channel);
  };
}
```

Register this complete existing channel set exactly once: `get-profiles`, `add-profile`, `delete-profile`, `launch-browser`, `close-browser`, `get-browser-status`, `get-browser-statuses`, `refresh-browser-status`, `forget-browser-process`, `rename-profile`, `open-profile-folder`, `clone-profile`, `get-profile-size`, `export-profiles`, `import-profiles`, `get-browser-settings`, `set-browser-settings`, `get-default-browser-path`, `get-platform`, `get-browser-environment`, and `browse-folder`. Keep validation at the IPC/service boundary.

- [ ] **Step 4: Make `main.js` a composition root**

`main.js` creates dependencies, registers handlers, initializes state, and creates windows. It must no longer contain profile CRUD/import/export handler implementations.

- [ ] **Step 5: Run syntax and test verification**

Run: `node --check main.js && node --check lib/ipc-handlers.js && npm test`

Expected: syntax succeeds and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/ipc-handlers.js test/ipc-handlers.test.js main.js
git commit -m "重构 IPC 注册与应用装配"
```

### Task 4: Renderer State Extraction

**Files:**
- Create: `renderer/profile-state.js`
- Create: `test/profile-state.test.js`
- Modify: `renderer/index.html`
- Modify: `renderer/index.js`

**Interfaces:**
- Produces: `createProfileState(initial)` with `getSnapshot`, `setProfiles`, `setStatuses`, `setFilter`, `setQuery`, `setSort`, `toggleSelection`, `clearSelection`, and `getVisibleProfiles`.
- Consumes: pure helpers from `renderer/view-utils.js`.

- [ ] **Step 1: Add failing state-transition tests**

```js
test('filter changes remove hidden selections', () => {
  const state = createProfileState({ profiles });
  state.toggleSelection('chrome-1');
  state.toggleSelection('firefox-1');
  state.setFilter('chrome');
  assert.deepEqual(state.getSnapshot().selectedIds, ['chrome-1']);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/profile-state.test.js`

Expected: FAIL because the state module is missing.

- [ ] **Step 3: Implement a framework-free state container**

The module must work in both Node tests and the browser using the existing UMD-style export pattern from `renderer/view-utils.js`. Return cloned snapshots and retain the current filter/search semantics.

- [ ] **Step 4: Route renderer mutations through the state container**

Load `profile-state.js` before `index.js`. Replace global `profiles`, status sets, selected IDs, filter, query, and sort variables with state calls; keep existing DOM and visible copy unchanged.

- [ ] **Step 5: Run renderer syntax and tests**

Run: `node --check renderer/profile-state.js && node --check renderer/index.js && node --test test/profile-state.test.js test/view-utils.test.js && npm test`

Expected: all tests pass and the main page behavior remains unchanged.

- [ ] **Step 6: Commit**

```bash
git add renderer/profile-state.js renderer/index.js renderer/index.html test/profile-state.test.js
git commit -m "重构配置页面状态管理"
```

### Task 5: Foundation Smoke Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all foundation modules.
- Produces: a behavior-compatible modular baseline for later plans.

- [ ] **Step 1: Document the new internal structure**

Update the project tree descriptions for `app-store`, `profile-service`, `ipc-handlers`, and `profile-state`; do not advertise future features yet.

- [ ] **Step 2: Run complete verification**

Run: `npm test && node --check main.js && node --check preload.js && node --check renderer/index.js && git diff --check`

Expected: all tests and syntax checks pass with no whitespace errors.

- [ ] **Step 3: Launch the application**

Run: `npm start`

Verify manually: existing profiles load, search/filter work, one profile launches/closes, settings load, metadata export remains minimal, and window recreation still works.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "更新模块化架构说明"
```
