# P0 Workspaces, Import Preview, and Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-workspace organization, favorites, sorting, safe two-phase imports, and actionable diagnostics.

**Architecture:** Extend the versioned store and extracted services with pure workspace/import/diagnostic helpers. Renderer state owns all filtering and sorting; privileged repairs remain in the main process.

**Tech Stack:** Electron, CommonJS JavaScript, electron-store, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-30-p0-tray-update-refactor-design.md`

## Global Constraints

- Requires the modular foundation plan to be complete.
- A profile belongs to zero or one workspace and may be independently favorited.
- Bulk work uses a fresh status snapshot and at most four concurrent operations.
- Exported/imported metadata contains only `browserType` and profile name.
- Unknown or running profiles cannot receive directory repairs.

---

### Task 1: Workspace Domain Service

**Files:**
- Create: `lib/workspace-service.js`
- Create: `test/workspace-service.test.js`
- Modify: `lib/app-store.js`
- Modify: `lib/ipc-handlers.js`
- Modify: `main.js`
- Modify: `preload.js`

**Interfaces:**
- Produces: `createWorkspaceService({ appStore, profileOperations, randomUUID, now })` with `list()`, `create({ name })`, `rename({ workspaceId, name })`, `remove({ workspaceId })`, `assign({ profileId, workspaceId })`, and `setFavorite({ profileId, favorite })`.

- [ ] **Step 1: Add failing lifecycle tests**

```js
test('removing a workspace only clears profile membership', async () => {
  await service.remove({ workspaceId: 'w1' });
  assert.equal(appStore.getProfiles()[0].workspaceId, null);
  assert.equal(appStore.getProfiles().length, 1);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/workspace-service.test.js`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement validation and atomic store updates**

Workspace names use the profile-name trimming, length, and case-insensitive uniqueness principles but never form filesystem paths. `assign` accepts `null` for ungrouping and rejects unknown IDs. `setFavorite` accepts only a boolean. Route all workspace and profile metadata mutations through the shared global profile-operation coordinator so they cannot overwrite concurrent profile changes.

- [ ] **Step 4: Register narrow IPC APIs**

Construct the service in `main.js`. Add `get-workspaces`, `create-workspace`, `rename-workspace`, `delete-workspace`, `assign-profile-workspace`, and `set-profile-favorite` to IPC and `window.browserAPI`.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/workspace-service.test.js test/ipc-handlers.test.js && npm test`

```bash
git add lib/workspace-service.js lib/app-store.js lib/ipc-handlers.js main.js preload.js test/workspace-service.test.js test/ipc-handlers.test.js
git commit -m "新增工作区与收藏服务"
```

### Task 2: Sorting and Recent Use

**Files:**
- Modify: `lib/profile-service.js`
- Modify: `lib/ipc-handlers.js`
- Modify: `renderer/profile-state.js`
- Modify: `renderer/view-utils.js`
- Modify: `test/profile-service.test.js`
- Modify: `test/profile-state.test.js`
- Modify: `test/view-utils.test.js`

**Interfaces:**
- Produces: `sortProfiles(profiles, sortMode, statusSnapshot)` supporting `name`, `created-desc`, `recent-desc`, and `status`; `profileService.markLaunched(profileId, timestamp)`.

- [ ] **Step 1: Add failing stable-sort and timestamp tests**

```js
test('recent sort puts never-launched profiles last and remains stable', () => {
  assert.deepEqual(sortProfiles(profiles, 'recent-desc', {}).map((p) => p.id), ['p2', 'p1', 'p3']);
});

test('only successful launch updates lastLaunchedAt', async () => {
  await profileService.launch('p1');
  assert.equal(appStore.getProfiles()[0].lastLaunchedAt, nowIso);
});
```

- [ ] **Step 2: Verify focused failure**

Run: `node --test test/profile-service.test.js test/profile-state.test.js test/view-utils.test.js`

- [ ] **Step 3: Implement deterministic sorting and launch updates**

Use normalized profile names as the final tie-breaker. In `profileService.launch`, update `lastLaunchedAt` only after `BrowserProcessManager.launch` returns `{ success: true }` and never for failed or already-running results. The existing `launch-browser` IPC continues to call this service method.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/profile-service.test.js test/profile-state.test.js test/view-utils.test.js && npm test`

```bash
git add lib/profile-service.js lib/ipc-handlers.js renderer/profile-state.js renderer/view-utils.js test/profile-service.test.js test/profile-state.test.js test/view-utils.test.js
git commit -m "新增配置排序与最近使用记录"
```

### Task 3: Workspace and Sort UI

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/index.js`
- Modify: `renderer/styles.css`

**Interfaces:**
- Consumes: workspace/favorite APIs and renderer sort state.
- Produces: sidebar filters, workspace CRUD modal, favorite toggle, assignment control, and workspace batch buttons.

- [ ] **Step 1: Add DOM structure with explicit controls**

Add sidebar buttons for `all`, `favorites`, `unassigned`, a custom workspace list, a sort `<select>`, and dialogs for creating/renaming/deleting workspaces. Every generated label passes through `escapeHtml`.

- [ ] **Step 2: Wire state transitions and persistence**

Persist only `sortMode` in localStorage. Workspace membership and favorite state must round-trip through IPC before updating renderer state. On failure, keep the previous state and show a toast.

- [ ] **Step 3: Add workspace bulk launch/close**

Take one fresh bulk status snapshot, filter safe targets, call `mapWithConcurrency(targets, 4, worker, onProgress)`, and use the existing bounded failure summary.

- [ ] **Step 4: Run syntax, unit, and manual checks**

Run: `node --check renderer/index.js && npm test`

Verify manually: workspace CRUD, ungrouping, favorite filter, all four sort modes, hidden-selection removal, and four-wide workspace launch/close.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/index.js renderer/styles.css
git commit -m "新增工作区收藏与排序界面"
```

### Task 4: Two-Phase Import

**Files:**
- Create: `lib/import-export-service.js`
- Create: `renderer/import-preview.js`
- Create: `test/import-export-service.test.js`
- Create: `test/import-preview.test.js`
- Modify: `lib/profile-service.js`
- Modify: `lib/ipc-handlers.js`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `renderer/index.html`
- Modify: `renderer/index.js`

**Interfaces:**
- Produces: `createImportExportService({ appStore, profileOperations, createProfileDir, pathExists, removeEmptyDirectory, now })` with `previewImport(document)` returning `{ token, valid, duplicates, invalid }` and `executeImport({ token, decisions })`; `profileService.previewImportMetadata()` owns the bounded file dialog/read boundary; renderer `buildImportDecisions(preview, defaultConflictMode)`.

- [ ] **Step 1: Add failing preview and rollback tests**

```js
test('preview has no filesystem or store side effects', async () => {
  const preview = await service.previewImport(validDocument);
  assert.equal(preview.valid.length, 1);
  assert.equal(createDirectory.calls.length, 0);
  assert.deepEqual(appStore.getProfiles(), existingProfiles);
});

test('execute rolls back records and newly-created empty directories', async () => {
  createDirectory.failOnCall(2);
  const result = await service.executeImport({ token, decisions });
  assert.equal(result.success, false);
  assert.deepEqual(appStore.getProfiles(), existingProfiles);
  assert.deepEqual(removeEmptyDirectory.calls, [firstCreatedPath]);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/import-export-service.test.js test/import-preview.test.js`

- [ ] **Step 3: Implement bounded preview tokens and decisions**

Keep preview tokens in memory with a ten-minute expiry and bind them to the parsed document digest. Accept only `skip` or `rename`; generate rename candidates with `createCloneProfileName`. Do not accept paths or workspace fields from the renderer.

Construct and inject the import service in `main.js`. Import execution must run through the shared global profile-operation coordinator. Track whether each directory existed before creation and roll back only directories newly created by this batch, using a non-recursive empty-directory removal primitive.

- [ ] **Step 4: Implement preview UI**

Show valid, duplicate, and invalid counts plus row details. Disable confirmation when invalid rows exist; allow cancel, skip duplicates, or auto-rename duplicates. Confirmation calls `execute-import` once.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/import-export-service.test.js test/import-preview.test.js test/import-reader.test.js test/profile-utils.test.js && npm test`

```bash
git add lib/import-export-service.js lib/profile-service.js lib/ipc-handlers.js main.js preload.js renderer/import-preview.js renderer/index.html renderer/index.js test/import-export-service.test.js test/import-preview.test.js
git commit -m "新增安全导入预览与冲突处理"
```

### Task 5: Diagnostics and Safe Repairs

**Files:**
- Create: `lib/diagnostics-service.js`
- Create: `test/diagnostics-service.test.js`
- Modify: `lib/ipc-handlers.js`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `renderer/index.html`
- Modify: `renderer/index.js`
- Modify: `renderer/styles.css`

**Interfaces:**
- Produces: `createDiagnosticsService({ appStore, profileOperations, browserProcessManager, getBrowserExecutable, getProfilesDir, pathExists, createProfileDir })` with `inspect(profileId)` and `repairMissingDirectory(profileId)`; construct and inject it in `main.js`.
- `inspect` returns `{ state, actions }`, where state is `healthy`, `browser-path-invalid`, `profile-directory-missing`, or `process-unknown`.

- [ ] **Step 1: Add failing state and safety tests**

```js
test('unknown process state forbids directory repair', async () => {
  processStatus.verificationUnavailable = true;
  const result = await service.repairMissingDirectory('p1');
  assert.deepEqual(result, { success: false, code: 'PROCESS_STATE_UNKNOWN' });
  assert.equal(createDirectory.calls.length, 0);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/diagnostics-service.test.js`

- [ ] **Step 3: Implement structured diagnosis and repair**

Force-refresh the process status before repairs, inside the shared per-profile mutation/lifecycle coordinator. Only create the exact validated profile path when status is definitively stopped and the path is absent. Return stable codes without raw paths, PIDs, commands, or system error text. State precedence is process unknown, invalid browser path, missing profile directory, then healthy; running state suppresses directory repair actions even when the directory is missing.

- [ ] **Step 4: Add card badges and diagnostic modal**

Expose retry, open settings, and recreate-empty-directory actions only when listed in `actions`. Never expose forget-process or process termination as an automatic repair.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/diagnostics-service.test.js test/browser-process-manager.test.js && npm test`

```bash
git add lib/diagnostics-service.js lib/ipc-handlers.js main.js preload.js renderer/index.html renderer/index.js renderer/styles.css test/diagnostics-service.test.js
git commit -m "新增配置诊断与安全修复"
```

### Task 6: P0 Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: documented P0 behavior and regression requirements.

- [ ] **Step 1: Document user behavior and contributor invariants**

Describe workspaces, favorites, sorting, import preview, diagnostics, metadata-only export, unknown-state restrictions, and the four-operation limit.

- [ ] **Step 2: Run complete verification**

Run: `npm test && node --check main.js && node --check renderer/index.js && git diff --check`

- [ ] **Step 3: Run manual smoke checks**

Run: `npm start`

Verify all workspace, sort, import, diagnosis, profile launch/close, filter, view, and custom browser-path flows.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "更新 P0 功能与测试指南"
```
