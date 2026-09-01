# Bulk Profile Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe bulk workspace assignment, favorite updates, and minimal-metadata export for selected profiles.

**Architecture:** Keep renderer requests narrow and move collection mutation into main-process services. Workspace and favorite changes use one serialized store mutation, selected export resolves IDs against current store state, and a focused renderer module owns menu state, response normalization, and summaries while `renderer/index.js` only wires DOM and refreshes persisted state.

**Tech Stack:** Electron 40, CommonJS JavaScript, HTML/CSS, `electron-store`, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-01-bulk-profile-organization-design.md`

## Global Constraints

- First release includes only workspace assignment, favorite/unfavorite, and selected export; no bulk delete, profile-directory copy, browser-data backup, drag sorting, or process operation.
- Selected export contains exactly `browserType` and `name`, using version 1 JSON; never include paths, workspace, favorite, timestamps, process records, or browser data.
- Batch requests contain 1–1000 unique non-empty profile IDs after deduplication.
- Workspace and favorite updates perform at most one `setProfiles` write and no write for an all-unchanged/all-missing request.
- Running, retryable-close, and unknown profiles remain eligible because these actions do not inspect or mutate processes or directories.
- Renderer results expose only stable states and never raw exceptions, dialog details, or machine paths.
- Existing launch, close, delete, recovery, diagnostics, and import behavior must remain unchanged.
- Use two-space indentation, semicolons, trailing commas, CommonJS modules, and Chinese commit subjects beginning with `新增`, `修复`, `优化`, or `更新`.

## File Structure

- `lib/workspace-service.js`: add atomic `assignMany` and `setFavoriteMany` collection mutations.
- `lib/profile-service.js`: let metadata export select current profiles by ID without weakening the existing full export.
- `lib/ipc-validation.js`: validate and deduplicate non-empty bounded batch ID arrays.
- `lib/ipc-handlers.js`: register, validate, and sanitize three new IPC requests.
- `preload.js`: expose only the three batch methods required by the home page.
- `renderer/profile-batch-organizer.js`: own menu state, keyboard focus calculation, response normalization, task execution, and Chinese summaries.
- `renderer/index.html`, `renderer/styles.css`, `renderer/index.js`: add accessible menu markup, presentation, and page wiring.
- `test/workspace-service.test.js`, `test/profile-service.test.js`, `test/ipc-validation.test.js`, `test/ipc-handlers.test.js`, `test/preload.test.js`: service and boundary regressions.
- `test/profile-batch-organizer.test.js`, `test/profile-batch-ui-contract.test.js`: focused renderer behavior and markup contracts.
- `README.md`: document the new selected-profile actions and privacy boundary.

---

### Task 1: Atomic Bulk Workspace and Favorite Mutations

**Files:**
- Modify: `test/workspace-service.test.js:15-219`
- Modify: `lib/workspace-service.js:27-143`

**Interfaces:**
- Consumes: `appStore.getProfiles()`, `appStore.getWorkspaces()`, `appStore.setProfiles(nextProfiles)`, and `profileOperations.runGlobalMutation(operation)`.
- Produces: `workspaceService.assignMany({ profileIds, workspaceId })` and `workspaceService.setFavoriteMany({ profileIds, favorite })` returning `{ success: true, updatedIds, unchangedIds, skippedIds }` or an existing safe service error.

- [ ] **Step 1: Extend the fixture to count or reject profile writes**

Add `rejectProfileWrites = false` to the fixture options, add `profileWriteCount` beside `identifier`, replace the fixture's existing `setProfiles`, and return the counter:

```js
let profileWriteCount = 0;

setProfiles: (nextProfiles) => {
  profileWriteCount += 1;
  if (rejectProfileWrites) throw new Error('Profile write failed');
  if (rejectSplitWrites) throw new Error('Separate profile writes are not allowed');
  storeState.profiles = structuredClone(nextProfiles);
},

return {
  service,
  appStore,
  profileOperations,
  storeState: () => structuredClone(storeState),
  profileWriteCount: () => profileWriteCount,
};
```

- [ ] **Step 2: Write failing classification and atomicity tests**

Append tests that lock storage-order result buckets and request-order skipped IDs:

```js
test('bulk workspace assignment classifies targets and writes once', async () => {
  const fixture = createServiceFixture({
    profiles: [
      { id: 'p1', workspaceId: null, favorite: false },
      { id: 'p2', workspaceId: 'w1', favorite: false },
      { id: 'p3', workspaceId: null, favorite: true },
    ],
    workspaces: [{ id: 'w1', name: 'Work', createdAt: '2026-08-30T00:00:00.000Z' }],
  });

  assert.deepEqual(await fixture.service.assignMany({
    profileIds: ['p3', 'missing', 'p2', 'p1', 'p3'],
    workspaceId: 'w1',
  }), {
    success: true,
    updatedIds: ['p1', 'p3'],
    unchangedIds: ['p2'],
    skippedIds: ['missing'],
  });
  assert.equal(fixture.profileWriteCount(), 1);
  assert.deepEqual(fixture.storeState().profiles.map(({ id, workspaceId }) => ({ id, workspaceId })), [
    { id: 'p1', workspaceId: 'w1' },
    { id: 'p2', workspaceId: 'w1' },
    { id: 'p3', workspaceId: 'w1' },
  ]);
});

test('bulk favorite no-op and missing targets avoid writes', async () => {
  const fixture = createServiceFixture({
    profiles: [{ id: 'p1', workspaceId: null, favorite: true }],
  });
  assert.deepEqual(await fixture.service.setFavoriteMany({
    profileIds: ['missing', 'p1'],
    favorite: true,
  }), {
    success: true,
    updatedIds: [],
    unchangedIds: ['p1'],
    skippedIds: ['missing'],
  });
  assert.equal(fixture.profileWriteCount(), 0);
});

test('bulk workspace assignment rejects an unknown workspace before writing', async () => {
  const fixture = createServiceFixture({
    profiles: [{ id: 'p1', workspaceId: null, favorite: false }],
  });
  assert.deepEqual(await fixture.service.assignMany({
    profileIds: ['p1'],
    workspaceId: 'missing',
  }), { success: false, error: 'Workspace not found' });
  assert.equal(fixture.profileWriteCount(), 0);
});

test('a rejected bulk profile write leaves stored profiles unchanged', async () => {
  const profiles = [{ id: 'p1', workspaceId: null, favorite: false }];
  const fixture = createServiceFixture({ profiles, rejectProfileWrites: true });
  await assert.rejects(
    fixture.service.setFavoriteMany({ profileIds: ['p1'], favorite: true }),
    /Profile write failed/u,
  );
  assert.deepEqual(fixture.storeState().profiles, profiles);
});

test('bulk workspace validation observes the latest serialized workspace state', async () => {
  const fixture = createServiceFixture({
    profiles: [{ id: 'p1', workspaceId: null, favorite: false }],
    workspaces: [{ id: 'w1', name: 'Work', createdAt: '2026-08-30T00:00:00.000Z' }],
  });
  let releaseRemoval;
  const removal = fixture.profileOperations.runGlobalMutation(async () => {
    await new Promise((resolve) => { releaseRemoval = resolve; });
    fixture.appStore.setWorkspaces([]);
  });
  await new Promise((resolve) => setImmediate(resolve));
  const assignment = fixture.service.assignMany({ profileIds: ['p1'], workspaceId: 'w1' });
  releaseRemoval();
  await removal;
  assert.deepEqual(await assignment, { success: false, error: 'Workspace not found' });
  assert.equal(fixture.profileWriteCount(), 0);
});
```

- [ ] **Step 3: Run the focused test and confirm the TDD failure**

Run: `node --test test/workspace-service.test.js`

Expected: FAIL because `assignMany` and `setFavoriteMany` are not functions.

- [ ] **Step 4: Implement one shared atomic collection updater**

Add a private helper and two public methods without changing the single-profile methods:

```js
function updateMany({ profileIds, key, value, validate = () => null }) {
  return profileOperations.runGlobalMutation(async () => {
    const validationFailure = validate();
    if (validationFailure) return validationFailure;
    const requestedIds = [...new Set(profileIds)];
    const requested = new Set(requestedIds);
    const found = new Set();
    const updatedIds = [];
    const unchangedIds = [];
    const profiles = appStore.getProfiles();
    const nextProfiles = profiles.map((profile) => {
      if (!requested.has(profile.id)) return profile;
      found.add(profile.id);
      if (profile[key] === value) {
        unchangedIds.push(profile.id);
        return profile;
      }
      updatedIds.push(profile.id);
      return { ...profile, [key]: value };
    });
    const skippedIds = requestedIds.filter((profileId) => !found.has(profileId));
    if (updatedIds.length > 0) appStore.setProfiles(nextProfiles);
    return { success: true, updatedIds, unchangedIds, skippedIds };
  });
}

function assignMany({ profileIds, workspaceId } = {}) {
  return updateMany({
    profileIds,
    key: 'workspaceId',
    value: workspaceId,
    validate: () => (
      workspaceId !== null
      && !appStore.getWorkspaces().some((workspace) => workspace.id === workspaceId)
        ? { success: false, error: 'Workspace not found' }
        : null
    ),
  });
}

function setFavoriteMany({ profileIds, favorite } = {}) {
  return updateMany({ profileIds, key: 'favorite', value: favorite });
}
```

Expose both methods from the returned service object. Input shape and primitive types remain the IPC boundary's responsibility.

- [ ] **Step 5: Run service regressions**

Run: `node --test test/workspace-service.test.js test/profile-operation-coordinator.test.js`

Expected: PASS, including existing single-profile serialization tests.

- [ ] **Step 6: Commit the service increment**

```bash
git add lib/workspace-service.js test/workspace-service.test.js
git commit -m "新增批量工作区与收藏服务"
```

---

### Task 2: Selected Minimal-Metadata Export

**Files:**
- Modify: `test/profile-service.test.js:14-104,553-631`
- Modify: `lib/profile-service.js:267-281`

**Interfaces:**
- Consumes: existing `createProfileExport(profiles)`, save dialog, export writer, and current `appStore.getProfiles()` order.
- Produces: `profileService.exportMetadata(profileIds)` where omitted `profileIds` preserves full export; selected export returns `{ success: true, count, skippedCount }`, `{ success: false, canceled: true }`, or `{ success: false, code: 'PROFILE_EXPORT_EMPTY_SELECTION', error: 'No profiles selected' }`.

- [ ] **Step 1: Track save-dialog calls in the profile-service fixture**

Replace the inline dialog dependency with an observable wrapper:

```js
const saveDialogCalls = [];
showSaveDialog: async (options) => {
  saveDialogCalls.push(options);
  return saveDialogResult;
},
return {
  service,
  storeState: () => structuredClone(storeState),
  createdDirectories,
  renamedDirectories,
  trashCalls,
  openPathCalls,
  launches,
  exportedFiles,
  saveDialogCalls,
};
```

- [ ] **Step 2: Write failing selected-export tests**

Append tests that prove minimal fields, stable store order, skipped counts, cancellation, and early empty rejection:

```js
test('selected export resolves current profiles in store order and keeps minimal fields', async () => {
  const fixture = createServiceFixture({
    profiles: [
      { id: 'p1', browserType: 'chrome', name: 'Work', path: '/private/p1', favorite: true },
      { id: 'p2', browserType: 'firefox', name: 'Personal', path: '/private/p2' },
      { id: 'p3', browserType: 'edge', name: 'Research', path: '/private/p3', workspaceId: 'w1' },
    ],
  });

  assert.deepEqual(await fixture.service.exportMetadata(['p3', 'missing', 'p1', 'p3']), {
    success: true,
    count: 2,
    skippedCount: 1,
  });
  assert.equal(fixture.exportedFiles[0].content, '{\n  "version": 1,\n  "profiles": [\n    {\n      "browserType": "chrome",\n      "name": "Work"\n    },\n    {\n      "browserType": "edge",\n      "name": "Research"\n    }\n  ]\n}\n');
});

test('selected export rejects an entirely stale selection before opening a dialog', async () => {
  const fixture = createServiceFixture({ profiles: [] });
  assert.deepEqual(await fixture.service.exportMetadata(['missing']), {
    success: false,
    code: 'PROFILE_EXPORT_EMPTY_SELECTION',
    error: 'No profiles selected',
  });
  assert.equal(fixture.saveDialogCalls.length, 0);
  assert.deepEqual(fixture.exportedFiles, []);
});

test('selected export cancellation preserves a stable canceled result', async () => {
  const fixture = createServiceFixture({
    profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work' }],
    saveDialogResult: { canceled: true },
  });
  assert.deepEqual(await fixture.service.exportMetadata(['p1']), {
    success: false,
    canceled: true,
  });
});
```

- [ ] **Step 3: Run the focused test and confirm the incorrect behavior**

Run: `node --test test/profile-service.test.js`

Expected: FAIL because `exportMetadata` ignores its selected IDs, exports every profile, and opens the dialog for an empty resolved selection.

- [ ] **Step 4: Resolve selected profiles before opening the save dialog**

Preserve the no-argument full export and add selected behavior:

```js
async function exportMetadata(profileIds) {
  try {
    const currentProfiles = appStore.getProfiles();
    let exportProfiles = currentProfiles;
    let skippedCount = 0;
    if (Array.isArray(profileIds)) {
      const requestedIds = new Set(profileIds);
      exportProfiles = currentProfiles.filter((profile) => requestedIds.has(profile.id));
      skippedCount = requestedIds.size - exportProfiles.length;
      if (exportProfiles.length === 0) {
        return operationFailure('PROFILE_EXPORT_EMPTY_SELECTION', 'No profiles selected');
      }
    }

    const result = await showSaveDialog({
      defaultPath: 'browser-profiles.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    const document = createProfileExport(exportProfiles);
    await writeExportFile(result.filePath, `${JSON.stringify(document, null, 2)}\n`);
    return {
      success: true,
      count: document.profiles.length,
      ...(Array.isArray(profileIds) ? { skippedCount } : {}),
    };
  } catch {
    return operationFailure('PROFILE_EXPORT_FAILED', 'Unable to export profiles');
  }
}
```

- [ ] **Step 5: Run export and privacy regressions**

Run: `node --test test/profile-service.test.js test/profile-utils.test.js test/import-export-service.test.js`

Expected: PASS; the legacy full export remains `{ success: true, count }` and selected output contains no organization or machine fields.

- [ ] **Step 6: Commit the export increment**

```bash
git add lib/profile-service.js test/profile-service.test.js
git commit -m "新增选中配置最小化导出"
```

---

### Task 3: Strict IPC Validation, Sanitization, and Preload Bridge

**Files:**
- Modify: `test/ipc-validation.test.js:1-33`
- Modify: `lib/ipc-validation.js:1-37`
- Modify: `test/ipc-handlers.test.js:10-130,487-559`
- Modify: `lib/ipc-handlers.js:1-527`
- Modify: `test/preload.test.js:38-62`
- Modify: `preload.js:59-78`

**Interfaces:**
- Consumes: Task 1 `assignMany`/`setFavoriteMany` and Task 2 `exportMetadata(profileIds)`.
- Produces: `validateBatchProfileIds(profileIds)` plus preload methods `assignProfilesWorkspace(profileIds, workspaceId)`, `setProfilesFavorite(profileIds, favorite)`, and `exportSelectedProfiles(profileIds)`.

- [ ] **Step 1: Write failing batch ID validation tests**

Add exact boundary cases:

```js
const { validateBatchProfileIds } = require('../lib/ipc-validation');

test('batch profile IDs deduplicate before enforcing the non-empty 1000-ID bound', () => {
  assert.deepEqual(validateBatchProfileIds(['p1', 'p1', 'p2']), ['p1', 'p2']);
  assert.deepEqual(validateBatchProfileIds(Array(1001).fill('p1')), ['p1']);
  assert.throws(() => validateBatchProfileIds([]), /Invalid batch profile IDs/u);
  assert.throws(
    () => validateBatchProfileIds(Array.from({ length: 1001 }, (_, index) => `p${index}`)),
    /Invalid batch profile IDs/u,
  );
  assert.throws(() => validateBatchProfileIds(['p1', ' ']), /Invalid profile ID/u);
});
```

- [ ] **Step 2: Write failing IPC and preload contract tests**

Add the channels to `expectedChannels`, fixture service methods, and assertions:

```js
// expectedChannels
'assign-profiles-workspace',
'set-profiles-favorite',
'export-selected-profiles',

test('batch organization IPC validates exact payloads and delegates deduplicated IDs', async () => {
  const calls = [];
  const { handlers } = createHandlerFixture({
    workspaceService: {
      assignMany: (payload) => {
        calls.push({ method: 'assignMany', payload });
        return { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] };
      },
      setFavoriteMany: (payload) => {
        calls.push({ method: 'setFavoriteMany', payload });
        return { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] };
      },
    },
    profileService: {
      exportMetadata: (profileIds) => {
        calls.push({ method: 'exportMetadata', payload: profileIds });
        return { success: true, count: 1, skippedCount: 0 };
      },
    },
  });

  assert.deepEqual(await handlers.get('assign-profiles-workspace')({}, {
    profileIds: ['p1', 'p1'],
    workspaceId: null,
  }), { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] });
  assert.deepEqual(await handlers.get('set-profiles-favorite')({}, {
    profileIds: ['p1'],
    favorite: true,
  }), { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] });
  assert.deepEqual(await handlers.get('export-selected-profiles')({}, {
    profileIds: ['p1'],
  }), { success: true, count: 1, skippedCount: 0 });
  assert.deepEqual(calls, [
    { method: 'assignMany', payload: { profileIds: ['p1'], workspaceId: null } },
    { method: 'setFavoriteMany', payload: { profileIds: ['p1'], favorite: true } },
    { method: 'exportMetadata', payload: ['p1'] },
  ]);
});

test('batch organization IPC rejects extra keys and sanitizes dependency failures', async () => {
  const secret = '/Users/private/profile';
  const { handlers } = createHandlerFixture({
    workspaceService: {
      assignMany: async () => { throw new Error(secret); },
    },
  });
  assert.deepEqual(await handlers.get('assign-profiles-workspace')({}, {
    profileIds: ['p1'],
    workspaceId: null,
    extra: true,
  }), { success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' });
  const failed = await handlers.get('assign-profiles-workspace')({}, {
    profileIds: ['p1'],
    workspaceId: null,
  });
  assert.deepEqual(failed, { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' });
  assert.equal(JSON.stringify(failed).includes(secret), false);
});
```

Extend the preload test:

```js
await browserApi.assignProfilesWorkspace(['p1', 'p2'], null);
await browserApi.setProfilesFavorite(['p1'], true);
await browserApi.exportSelectedProfiles(['p2']);
assert.deepEqual(JSON.parse(JSON.stringify(invocations.slice(-3))), [
  { channel: 'assign-profiles-workspace', args: [{ profileIds: ['p1', 'p2'], workspaceId: null }] },
  { channel: 'set-profiles-favorite', args: [{ profileIds: ['p1'], favorite: true }] },
  { channel: 'export-selected-profiles', args: [{ profileIds: ['p2'] }] },
]);
```

- [ ] **Step 3: Run boundary tests and confirm missing APIs**

Run: `node --test test/ipc-validation.test.js test/ipc-handlers.test.js test/preload.test.js`

Expected: FAIL because the validator, channels, service delegation, and preload methods do not exist.

- [ ] **Step 4: Implement streaming deduplication with a unique-ID cap**

Add and export:

```js
const MAX_BATCH_PROFILE_IDS = 1000;

function validateBatchProfileIds(profileIds) {
  if (!Array.isArray(profileIds) || profileIds.length === 0) {
    throw new Error('Invalid batch profile IDs');
  }
  const seen = new Set();
  const validated = [];
  for (const profileId of profileIds) {
    const value = validateProfileId(profileId);
    if (seen.has(value)) continue;
    seen.add(value);
    validated.push(value);
    if (validated.length > MAX_BATCH_PROFILE_IDS) {
      throw new Error('Invalid batch profile IDs');
    }
  }
  return validated;
}
```

- [ ] **Step 5: Register exact request parsers and stable channel results**

Use `readExactRecord` to reject prototypes, accessors, symbols, and extra keys. Add request functions with separate validation and dependency failure handling:

```js
function batchProfileRequest(payload, keys) {
  const request = readExactRecord(payload, keys);
  if (!request) throw new Error('Invalid batch profile request');
  return { ...request, profileIds: validateBatchProfileIds(request.profileIds) };
}

function batchWorkspaceRequest(payload) {
  const request = batchProfileRequest(payload, ['profileIds', 'workspaceId']);
  return {
    profileIds: request.profileIds,
    workspaceId: validateWorkspaceIdOrNull(request.workspaceId),
  };
}

function batchFavoriteRequest(payload) {
  const request = batchProfileRequest(payload, ['favorite', 'profileIds']);
  if (typeof request.favorite !== 'boolean') throw new Error('Invalid favorite value');
  return request;
}

function batchExportRequest(payload) {
  return batchProfileRequest(payload, ['profileIds']);
}

async function runBatchProfileRequest(parseRequest, payload, operation) {
  let request;
  try {
    request = parseRequest(payload);
  } catch {
    return { success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' };
  }
  try {
    return await operation(request);
  } catch {
    return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
  }
}
```

Register handlers with exact primitive checks:

```js
['assign-profiles-workspace', (_event, payload) => runBatchProfileRequest(
  batchWorkspaceRequest,
  payload,
  (request) => workspaceService.assignMany(request),
)],
['set-profiles-favorite', (_event, payload) => runBatchProfileRequest(
  batchFavoriteRequest,
  payload,
  (request) => workspaceService.setFavoriteMany(request),
)],
['export-selected-profiles', (_event, payload) => runBatchProfileRequest(
  batchExportRequest,
  payload,
  (request) => profileService.exportMetadata(request.profileIds),
)],
```

Place `export-selected-profiles` immediately after `export-profiles` in both the handler map and `expectedChannels`. Place `assign-profiles-workspace` and `set-profiles-favorite` immediately after their existing single-profile counterparts.

In `sanitizeResult`, accept success buckets only when all entries are unique requested IDs, buckets do not overlap, and every requested ID is classified. Implement the sanitizer rather than returning raw service objects:

```js
function sanitizeBatchMutationResult(result, payload) {
  if (result?.success !== true) {
    if (result?.code === 'BATCH_PROFILE_REQUEST_INVALID') {
      return { success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' };
    }
    if (result?.error === 'Workspace not found') {
      return { success: false, code: 'WORKSPACE_NOT_FOUND' };
    }
    return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
  }
  let requestedIds;
  try {
    requestedIds = validateBatchProfileIds(payload?.profileIds);
  } catch {
    return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
  }
  const requested = new Set(requestedIds);
  const used = new Set();
  const sanitized = {};
  for (const key of ['updatedIds', 'unchangedIds', 'skippedIds']) {
    if (!Array.isArray(result[key])) {
      return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
    }
    sanitized[key] = [];
    for (const profileId of result[key]) {
      if (typeof profileId !== 'string'
        || !requested.has(profileId)
        || used.has(profileId)) {
        return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
      }
      used.add(profileId);
      sanitized[key].push(profileId);
    }
  }
  if (used.size !== requested.size) {
    return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
  }
  return { success: true, ...sanitized };
}

function sanitizeSelectedExportResult(result) {
  if (result?.success === true
    && Number.isSafeInteger(result.count)
    && result.count > 0
    && Number.isSafeInteger(result.skippedCount)
    && result.skippedCount >= 0) {
    return { success: true, count: result.count, skippedCount: result.skippedCount };
  }
  if (result?.canceled === true) return { success: false, canceled: true };
  if (result?.code === 'BATCH_PROFILE_REQUEST_INVALID') {
    return { success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' };
  }
  if (result?.code === 'PROFILE_EXPORT_EMPTY_SELECTION') {
    return { success: false, code: 'PROFILE_EXPORT_EMPTY_SELECTION' };
  }
  return { success: false, code: 'PROFILE_EXPORT_FAILED' };
}
```

Route the two mutation channels through `sanitizeBatchMutationResult(result, args[1])` and selected export through `sanitizeSelectedExportResult(result)`. Add matching `fallbackResult` branches returning only the fixed failure codes so raw exceptions never fall through to profile or workspace English messages.

- [ ] **Step 6: Expose the three narrow preload methods**

Add only these calls:

```js
assignProfilesWorkspace: (profileIds, workspaceId) => (
  ipcRenderer.invoke('assign-profiles-workspace', { profileIds, workspaceId })
),
setProfilesFavorite: (profileIds, favorite) => (
  ipcRenderer.invoke('set-profiles-favorite', { profileIds, favorite })
),
exportSelectedProfiles: (profileIds) => (
  ipcRenderer.invoke('export-selected-profiles', { profileIds })
),
```

- [ ] **Step 7: Run IPC and full service boundary tests**

Run: `node --test test/ipc-validation.test.js test/ipc-handlers.test.js test/preload.test.js test/workspace-service.test.js test/profile-service.test.js`

Expected: PASS with no private path in serialized results.

- [ ] **Step 8: Commit the IPC boundary increment**

```bash
git add lib/ipc-validation.js lib/ipc-handlers.js preload.js test/ipc-validation.test.js test/ipc-handlers.test.js test/preload.test.js
git commit -m "新增批量整理安全接口"
```

---

### Task 4: Renderer Batch Organizer Module

**Files:**
- Create: `test/profile-batch-organizer.test.js`
- Create: `renderer/profile-batch-organizer.js`

**Interfaces:**
- Consumes: an injected `runBatch(operation)` coordinator, the three Task 3 API methods, and injected `reloadProfiles()`.
- Produces: `createBatchMenuState()`, `nextMenuItemIndex(currentIndex, key, itemCount)`, `normalizeMutationResult(result, requestedIds)`, `formatMutationSummary(result)`, and `createProfileBatchOrganizer(options)`.

- [ ] **Step 1: Write failing pure state, keyboard, and sanitizer tests**

Create the test file with these contracts:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const organizer = require('../renderer/profile-batch-organizer');

test('batch menu is visible only with selection and closes when busy or empty', () => {
  const state = organizer.createBatchMenuState();
  assert.deepEqual(state.getSnapshot(), { count: 0, visible: false, open: false, busy: false });
  state.setSelectedCount(2);
  state.toggle();
  assert.deepEqual(state.getSnapshot(), { count: 2, visible: true, open: true, busy: false });
  state.setBusy(true);
  assert.deepEqual(state.getSnapshot(), { count: 2, visible: true, open: false, busy: true });
  state.setBusy(false);
  state.setSelectedCount(0);
  assert.equal(state.getSnapshot().visible, false);
});

test('menu focus navigation wraps and supports Home and End', () => {
  assert.equal(organizer.nextMenuItemIndex(0, 'ArrowUp', 3), 2);
  assert.equal(organizer.nextMenuItemIndex(2, 'ArrowDown', 3), 0);
  assert.equal(organizer.nextMenuItemIndex(1, 'Home', 3), 0);
  assert.equal(organizer.nextMenuItemIndex(1, 'End', 3), 2);
  assert.equal(organizer.nextMenuItemIndex(1, 'Escape', 3), null);
});

test('mutation results keep only disjoint requested ID buckets', () => {
  assert.deepEqual(organizer.normalizeMutationResult({
    success: true,
    updatedIds: ['p1'],
    unchangedIds: ['p2'],
    skippedIds: ['missing'],
  }, ['p1', 'p2', 'missing']), {
    success: true,
    updatedIds: ['p1'],
    unchangedIds: ['p2'],
    skippedIds: ['missing'],
  });
  assert.deepEqual(organizer.normalizeMutationResult({
    success: true,
    updatedIds: ['p1'],
    unchangedIds: ['p1'],
    skippedIds: [],
  }, ['p1']), { success: false, code: 'BATCH_ORGANIZATION_FAILED' });
});

test('mutation summary uses fixed Chinese counts', () => {
  assert.equal(organizer.formatMutationSummary({
    success: true,
    updatedIds: ['p1', 'p2'],
    unchangedIds: ['p3'],
    skippedIds: ['missing'],
  }), '已更新 2 项、未变化 1 项、跳过 1 项');
});
```

- [ ] **Step 2: Write failing task execution tests**

Cover successful reload, refresh failure, export cancellation, and re-entry delegation:

```js
test('workspace organization delegates once and reloads persisted profiles', async () => {
  const calls = [];
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async (operation) => operation(),
    assignProfilesWorkspace: async (profileIds, workspaceId) => {
      calls.push({ profileIds, workspaceId });
      return { success: true, updatedIds: ['p1'], unchangedIds: [], skippedIds: [] };
    },
    setProfilesFavorite: async () => assert.fail('favorite must not run'),
    exportSelectedProfiles: async () => assert.fail('export must not run'),
    reloadProfiles: async () => { calls.push('reload'); },
  });
  assert.deepEqual(await batch.assignWorkspace(['p1'], null), {
    success: true,
    message: '已更新 1 项、未变化 0 项、跳过 0 项',
    refreshFailed: false,
  });
  assert.deepEqual(calls, [{ profileIds: ['p1'], workspaceId: null }, 'reload']);
});

test('selected export cancellation is neutral and does not reload profiles', async () => {
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async (operation) => operation(),
    assignProfilesWorkspace: async () => {},
    setProfilesFavorite: async () => {},
    exportSelectedProfiles: async () => ({ success: false, canceled: true }),
    reloadProfiles: async () => assert.fail('export must not reload profiles'),
  });
  assert.deepEqual(await batch.exportSelected(['p1']), {
    success: false,
    canceled: true,
    message: '已取消导出',
  });
});

test('a committed mutation reports refresh failure without fabricating local data', async () => {
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async (operation) => operation(),
    assignProfilesWorkspace: async () => ({
      success: true,
      updatedIds: ['p1'],
      unchangedIds: [],
      skippedIds: [],
    }),
    setProfilesFavorite: async () => assert.fail('favorite must not run'),
    exportSelectedProfiles: async () => assert.fail('export must not run'),
    reloadProfiles: async () => { throw new Error('/private/refresh'); },
  });
  assert.deepEqual(await batch.assignWorkspace(['p1'], 'w1'), {
    success: true,
    message: '已更新 1 项、未变化 0 项、跳过 0 项',
    refreshFailed: true,
  });
});

test('selected export reports stable success counts and skipped targets', async () => {
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async (operation) => operation(),
    assignProfilesWorkspace: async () => {},
    setProfilesFavorite: async () => {},
    exportSelectedProfiles: async () => ({ success: true, count: 2, skippedCount: 1 }),
    reloadProfiles: async () => assert.fail('export must not reload profiles'),
  });
  assert.deepEqual(await batch.exportSelected(['p1', 'p2', 'missing']), {
    success: true,
    message: '已导出 2 项、跳过 1 项',
  });
});

test('organizer delegates re-entry rejection without invoking an API', async () => {
  let apiCalls = 0;
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async () => ({ skipped: true, code: 'BATCH_ALREADY_RUNNING' }),
    assignProfilesWorkspace: async () => { apiCalls += 1; },
    setProfilesFavorite: async () => { apiCalls += 1; },
    exportSelectedProfiles: async () => { apiCalls += 1; },
    reloadProfiles: async () => { apiCalls += 1; },
  });
  assert.deepEqual(await batch.setFavorite(['p1'], false), {
    skipped: true,
    code: 'BATCH_ALREADY_RUNNING',
  });
  assert.equal(apiCalls, 0);
});
```

- [ ] **Step 3: Run the new test and confirm the missing module**

Run: `node --test test/profile-batch-organizer.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `renderer/profile-batch-organizer.js`.

- [ ] **Step 4: Implement the UMD module with no DOM dependency**

Follow existing renderer module exposure and keep API responses narrowed:

```js
(function exposeProfileBatchOrganizer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.profileBatchOrganizer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function createBatchMenuState() {
    let count = 0;
    let open = false;
    let busy = false;
    return {
      setSelectedCount(value) {
        count = Number.isSafeInteger(value) && value > 0 ? value : 0;
        if (count === 0) open = false;
      },
      setBusy(value) {
        busy = value === true;
        if (busy) open = false;
      },
      toggle() {
        if (count > 0 && !busy) open = !open;
      },
      close() { open = false; },
      getSnapshot() { return { count, visible: count > 0, open, busy }; },
    };
  }

  function nextMenuItemIndex(currentIndex, key, itemCount) {
    if (!Number.isSafeInteger(itemCount) || itemCount < 1) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return itemCount - 1;
    if (key === 'ArrowDown') return (currentIndex + 1 + itemCount) % itemCount;
    if (key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
    return null;
  }

  function normalizeMutationResult(result, requestedIds) {
    if (result?.success !== true) {
      return { success: false, code: result?.code || 'BATCH_ORGANIZATION_FAILED' };
    }
    const requested = new Set(requestedIds);
    const used = new Set();
    const buckets = {};
    for (const key of ['updatedIds', 'unchangedIds', 'skippedIds']) {
      if (!Array.isArray(result[key])) {
        return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
      }
      buckets[key] = [];
      for (const profileId of result[key]) {
        if (typeof profileId !== 'string'
          || !requested.has(profileId)
          || used.has(profileId)) {
          return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
        }
        used.add(profileId);
        buckets[key].push(profileId);
      }
    }
    if (used.size !== requested.size) {
      return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
    }
    return { success: true, ...buckets };
  }

  function formatMutationSummary(result) {
    return `已更新 ${result.updatedIds.length} 项、未变化 ${result.unchangedIds.length} 项、跳过 ${result.skippedIds.length} 项`;
  }

  function createProfileBatchOrganizer({
    runBatch,
    assignProfilesWorkspace,
    setProfilesFavorite,
    exportSelectedProfiles,
    reloadProfiles,
  }) {
    async function runMutation(profileIds, operation) {
      return runBatch(async () => {
        let rawResult;
        try {
          rawResult = await operation();
        } catch {
          return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
        }
        const result = normalizeMutationResult(rawResult, profileIds);
        if (!result.success) return result;
        let refreshFailed = false;
        try {
          await reloadProfiles();
        } catch {
          refreshFailed = true;
        }
        return {
          success: true,
          message: formatMutationSummary(result),
          refreshFailed,
        };
      });
    }

    return {
      assignWorkspace(profileIds, workspaceId) {
        return runMutation(
          profileIds,
          () => assignProfilesWorkspace(profileIds, workspaceId),
        );
      },
      setFavorite(profileIds, favorite) {
        return runMutation(
          profileIds,
          () => setProfilesFavorite(profileIds, favorite),
        );
      },
      exportSelected(profileIds) {
        return runBatch(async () => {
          let result;
          try {
            result = await exportSelectedProfiles(profileIds);
          } catch {
            return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
          }
          if (result?.canceled === true) {
            return { success: false, canceled: true, message: '已取消导出' };
          }
          if (result?.success !== true
            || !Number.isSafeInteger(result.count)
            || result.count < 1
            || !Number.isSafeInteger(result.skippedCount)
            || result.skippedCount < 0) {
            return { success: false, code: result?.code || 'BATCH_ORGANIZATION_FAILED' };
          }
          return {
            success: true,
            message: result.skippedCount > 0
              ? `已导出 ${result.count} 项、跳过 ${result.skippedCount} 项`
              : `已导出 ${result.count} 项`,
          };
        });
      },
    };
  }

  return { createBatchMenuState, nextMenuItemIndex, normalizeMutationResult,
    formatMutationSummary, createProfileBatchOrganizer };
}));
```

`createProfileBatchOrganizer` must route all three methods through injected `runBatch`; mutation methods normalize the response, reload only after accepted success, and return `refreshFailed: true` if the persisted refresh rejects. It must not alter profile objects itself. Export returns `已导出 N 项` on success, `已取消导出` on cancel, and a fixed `BATCH_ORGANIZATION_FAILED` result for malformed responses.

- [ ] **Step 5: Run renderer-module tests**

Run: `node --test test/profile-batch-organizer.test.js test/workspace-batch.test.js test/profile-state.test.js`

Expected: PASS; the existing page coordinator remains the single re-entry gate.

- [ ] **Step 6: Commit the renderer domain module**

```bash
git add renderer/profile-batch-organizer.js test/profile-batch-organizer.test.js
git commit -m "新增批量整理渲染控制器"
```

---

### Task 5: Accessible Menu Markup and Home-Page Wiring

**Files:**
- Create: `test/profile-batch-ui-contract.test.js`
- Modify: `renderer/index.html:48-85,227-233`
- Modify: `renderer/styles.css:320-430,1402-1512`
- Modify: `renderer/index.js:3-66,118-135,1183-1348`

**Interfaces:**
- Consumes: Task 3 preload methods, Task 4 `profileBatchOrganizer`, current `profileState`, current `workspaces`, and current `pageBatchCoordinator`.
- Produces: an accessible “整理选中（N）” menu whose actions reload persisted profiles and retain only still-visible selections.

- [ ] **Step 1: Write failing HTML and page-wiring contract tests**

Create a source contract that does not require a new DOM dependency:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.js'), 'utf8');

test('home page includes an accessible selected-profile organization menu', () => {
  assert.match(html, /id="organizeSelectedBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/u);
  assert.match(html, /id="organizeSelectedMenu"[^>]*role="menu"[^>]*hidden/u);
  assert.match(html, /id="organizeWorkspaceMenu"[^>]*role="menu"/u);
  assert.match(html, /data-organize-action="favorite"/u);
  assert.match(html, /data-organize-action="unfavorite"/u);
  assert.match(html, /data-organize-action="export"/u);
});

test('batch organizer module loads before the home-page entry point', () => {
  assert.ok(html.indexOf('profile-batch-organizer.js') < html.indexOf('index.js'));
  assert.match(source, /window\.profileBatchOrganizer/u);
  assert.match(source, /assignProfilesWorkspace/u);
  assert.match(source, /setProfilesFavorite/u);
  assert.match(source, /exportSelectedProfiles/u);
});
```

- [ ] **Step 2: Run the UI contract and confirm missing markup**

Run: `node --test test/profile-batch-ui-contract.test.js`

Expected: FAIL because the button, menus, script, and wiring do not exist.

- [ ] **Step 3: Add semantic menu markup and script order**

Place this beside existing selected launch/close buttons:

```html
<div id="organizeSelectedGroup" class="batch-organize" hidden>
  <button id="organizeSelectedBtn" class="btn btn-secondary" type="button"
    aria-haspopup="menu" aria-expanded="false">
    整理选中（0）
  </button>
  <div id="organizeSelectedMenu" class="batch-organize-menu" role="menu" hidden>
    <button type="button" role="menuitem" data-organize-action="workspace"
      aria-haspopup="menu" aria-expanded="false">移动到工作区</button>
    <div id="organizeWorkspaceMenu" class="batch-organize-submenu" role="menu" hidden></div>
    <button type="button" role="menuitem" data-organize-action="favorite">收藏选中</button>
    <button type="button" role="menuitem" data-organize-action="unfavorite">取消收藏</button>
    <button type="button" role="menuitem" data-organize-action="export">导出选中</button>
  </div>
</div>
```

Load `profile-batch-organizer.js` after `workspace-batch.js` and before `index.js`.

- [ ] **Step 4: Add bounded, responsive menu styling**

Add positioned menus with a high local stacking order, minimum 44-pixel interactive rows, visible focus, and a responsive submenu that remains inside the viewport:

```css
.batch-organize {
  position: relative;
}

.batch-organize-menu,
.batch-organize-submenu {
  position: absolute;
  z-index: 100;
  min-width: 190px;
  max-width: min(280px, calc(100vw - 32px));
  padding: 6px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--card-bg);
  box-shadow: var(--shadow-lg);
}

.batch-organize-menu {
  top: calc(100% + 6px);
  right: 0;
}

.batch-organize-menu button,
.batch-organize-submenu button {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
```

Under `@media (max-width: 768px)`, anchor both menus to the right edge and render the workspace submenu below its parent item instead of outside the main menu.

- [ ] **Step 5: Wire menu rendering and the shared batch coordinator**

At module import time create state and organizer:

```js
const {
  createBatchMenuState,
  createProfileBatchOrganizer,
  nextMenuItemIndex,
} = window.profileBatchOrganizer;
const batchMenuState = createBatchMenuState();
const batchOrganizer = createProfileBatchOrganizer({
  runBatch: (operation) => pageBatchCoordinator.run(operation),
  assignProfilesWorkspace: (...args) => window.browserAPI.assignProfilesWorkspace(...args),
  setProfilesFavorite: (...args) => window.browserAPI.setProfilesFavorite(...args),
  exportSelectedProfiles: (...args) => window.browserAPI.exportSelectedProfiles(...args),
  reloadProfiles: async () => {
    profileState.setProfiles(await window.browserAPI.getProfiles());
    renderProfiles();
  },
});
```

Because `pageBatchCoordinator` is currently constructed before all domain imports are available, instantiate `batchOrganizer` immediately after `pageBatchCoordinator`; keep `batchMenuState` creation with the imports.

Add `organizeSelectedBtn` to `setPageBatchBusy`, call `batchMenuState.setBusy(busy)`, and render the closed state. Create one `updateSelectedActionButtons()` function that calls the existing launch and close updates plus:

```js
function updateOrganizeSelectedButton() {
  const count = profileState.getSnapshot().selectedIds.length;
  batchMenuState.setSelectedCount(count);
  const state = batchMenuState.getSnapshot();
  organizeSelectedGroup.hidden = !state.visible;
  organizeSelectedBtn.disabled = state.busy;
  organizeSelectedBtn.textContent = state.busy ? '处理中…' : `整理选中（${state.count}）`;
  organizeSelectedBtn.setAttribute('aria-expanded', String(state.open));
  organizeSelectedMenu.hidden = !state.open;
}
```

Replace paired `updateLaunchSelectedButton()`/`updateCloseSelectedButton()` call sites after selection, filter, status, and profile refreshes with `updateSelectedActionButtons()` so all three controls stay synchronized.

- [ ] **Step 6: Wire safe actions, refresh, focus, and outside close**

Render workspace targets with escaped IDs/names and a dedicated `data-organize-workspace-id`; represent unassigned with an empty attribute and translate it to `null`. Action listeners take a fresh `selectedIds` snapshot immediately before dispatch:

```js
async function runOrganizationAction(action, value) {
  const profileIds = profileState.getSnapshot().selectedIds;
  if (profileIds.length === 0) return;
  closeOrganizationMenu(false);
  let result;
  if (action === 'workspace') result = await batchOrganizer.assignWorkspace(profileIds, value);
  else if (action === 'favorite') result = await batchOrganizer.setFavorite(profileIds, true);
  else if (action === 'unfavorite') result = await batchOrganizer.setFavorite(profileIds, false);
  else result = await batchOrganizer.exportSelected(profileIds);

  if (result?.canceled) showToast(result.message, 'info');
  else if (result?.success && result.refreshFailed) showToast('整理完成，但刷新配置列表失败', 'warning');
  else if (result?.success) showToast(result.message, 'success');
  else showToast('批量整理失败，请重试', 'error');
  updateSelectedActionButtons();
}
```

Opening focuses the first enabled menu item. Arrow keys call `nextMenuItemIndex`, `Home`/`End` jump, `Escape` closes and restores trigger focus, and an outside pointer event closes without moving focus. Toggling the workspace item opens its submenu and focuses “未分组”; selecting a target closes both menus before awaiting the request.

- [ ] **Step 7: Run renderer and contract regressions**

Run: `node --test test/profile-batch-organizer.test.js test/profile-batch-ui-contract.test.js test/profile-state.test.js test/workspace-batch.test.js test/preload.test.js`

Expected: PASS. Confirm source contains no `innerHTML` interpolation of unescaped workspace IDs or names.

- [ ] **Step 8: Commit the UI increment**

```bash
git add renderer/index.html renderer/styles.css renderer/index.js test/profile-batch-ui-contract.test.js
git commit -m "新增选中配置批量整理菜单"
```

---

### Task 6: Documentation and End-to-End Verification

**Files:**
- Modify: `README.md:7-70`
- Verify: all production and test files changed in Tasks 1–5

**Interfaces:**
- Consumes: the complete feature.
- Produces: user-facing usage documentation and evidence that tests, packaging, and manual acceptance pass.

- [ ] **Step 1: Update the README feature and usage sections**

Add a feature bullet and extend selection instructions with exact privacy wording:

```markdown
- 选中配置的批量工作区分配、收藏与最小元数据导出
```

```markdown
选中配置后，可通过“整理选中”统一移动工作区、收藏/取消收藏或只导出选中项。选中项导出仍只包含浏览器类型和配置名称，不包含工作区、收藏、路径、时间、进程信息或浏览数据。
```

- [ ] **Step 2: Run syntax and whitespace checks**

Run:

```bash
node --check lib/workspace-service.js
node --check lib/profile-service.js
node --check lib/ipc-validation.js
node --check lib/ipc-handlers.js
node --check preload.js
node --check renderer/profile-batch-organizer.js
node --check renderer/index.js
git diff --check
```

Expected: every command exits 0 with no output.

- [ ] **Step 3: Run focused feature tests**

Run:

```bash
node --test test/workspace-service.test.js test/profile-service.test.js test/ipc-validation.test.js test/ipc-handlers.test.js test/preload.test.js test/profile-batch-organizer.test.js test/profile-batch-ui-contract.test.js test/profile-state.test.js test/workspace-batch.test.js
```

Expected: all focused tests pass with zero failures, skips, or cancellations.

- [ ] **Step 4: Run the complete automated suite**

Run: `npm test`

Expected: all repository tests pass.

- [ ] **Step 5: Perform the Electron acceptance matrix**

Run: `npm start`, create or use at least three disposable profiles, then verify:

1. Select profiles across list and grid views; “整理选中（N）” matches the visible selection count.
2. Move mixed targets into a workspace; updated, unchanged, and skipped counts are correct and still-visible selections remain selected.
3. In a workspace or favorites filter, move/unfavorite selected profiles; disappearing cards are automatically deselected.
4. Apply favorite and unfavorite to mixed targets; no browser is launched or closed.
5. Export selected profiles; inspect JSON and confirm it contains only `version`, `profiles[].browserType`, and `profiles[].name` in current profile order.
6. Cancel the save dialog; the UI reports cancellation neutrally and retains selection.
7. Use keyboard-only navigation: open, arrows, Home, End, workspace submenu, activation, and Escape focus restoration.
8. Start a batch action and confirm launch, close, and organize batch buttons remain disabled until completion.

Expected: all eight checks pass; no raw path or exception text appears in the UI.

- [ ] **Step 6: Build the local macOS packages**

Run: `npm run build:mac`

Expected: exit 0 and `dist/` contains x64 and arm64 DMGs for the current manifest version. Open the packaged app once with an isolated user-data directory and repeat one workspace assignment plus one selected export smoke check.

- [ ] **Step 7: Commit documentation after all verification is green**

```bash
git add README.md
git commit -m "更新批量整理使用说明"
```

- [ ] **Step 8: Record the merge gate without pushing**

Run:

```bash
git status --short
git log --oneline --decorate -6
```

Expected: clean worktree and the feature commits visible. Report test totals, manual checks, package filenames, and current commit to the user. Do not merge or push until the user explicitly approves after reviewing this evidence.
