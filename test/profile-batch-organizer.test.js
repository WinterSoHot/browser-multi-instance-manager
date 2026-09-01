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

test('keyboard organization actions use a stable fallback while pending and restore an available trigger', () => {
  assert.equal(organizer.getOrganizationActionFocusTarget({
    activationType: 'keyboard',
    pending: true,
    triggerAvailable: true,
  }), 'fallback');
  assert.equal(organizer.getOrganizationActionFocusTarget({
    activationType: 'keyboard',
    pending: false,
    triggerAvailable: true,
  }), 'trigger');
  assert.equal(organizer.getOrganizationActionFocusTarget({
    activationType: 'keyboard',
    pending: false,
    triggerAvailable: false,
  }), 'fallback');
});

test('pointer organization actions never request a programmatic focus move', () => {
  assert.equal(organizer.getOrganizationActionFocusTarget({
    activationType: 'pointer',
    pending: false,
    triggerAvailable: true,
  }), null);
});

test('workspace organization menu retains every target in a many-workspace list', () => {
  const workspaces = Array.from({ length: 200 }, (_, index) => ({
    id: `workspace-${index + 1}`,
    name: `Workspace ${index + 1}`,
  }));
  const targets = organizer.getOrganizationWorkspaceTargets(workspaces);
  assert.equal(targets.length, 201);
  assert.deepEqual(targets[0], { id: '', name: '未分组' });
  assert.deepEqual(targets[200], { id: 'workspace-200', name: 'Workspace 200' });
});

test('menu viewport height is derived from its actual viewport top', () => {
  assert.equal(organizer.getMenuViewportMaxHeight(700, 180, 16), 504);
  assert.equal(organizer.getMenuViewportMaxHeight(700, 684, 16), 0);
  assert.equal(organizer.getMenuViewportMaxHeight(700, 720, 16), 0);
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

test('mutation failure maps an unsafe dependency code to the stable batch failure code', async () => {
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async (operation) => operation(),
    assignProfilesWorkspace: async () => ({
      success: false,
      code: '/Users/private/profile',
    }),
    setProfilesFavorite: async () => assert.fail('favorite must not run'),
    exportSelectedProfiles: async () => assert.fail('export must not run'),
    reloadProfiles: async () => assert.fail('failed mutation must not reload profiles'),
  });
  const result = await batch.assignWorkspace(['p1'], 'w1');
  assert.deepEqual(result, { success: false, code: 'BATCH_ORGANIZATION_FAILED' });
  assert.equal(JSON.stringify(result).includes('/Users/private/profile'), false);
});

test('export failure maps an unsafe dependency code to the stable batch failure code', async () => {
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async (operation) => operation(),
    assignProfilesWorkspace: async () => assert.fail('workspace mutation must not run'),
    setProfilesFavorite: async () => assert.fail('favorite must not run'),
    exportSelectedProfiles: async () => ({
      success: false,
      code: '/Users/private/profile',
    }),
    reloadProfiles: async () => assert.fail('export must not reload profiles'),
  });
  const result = await batch.exportSelected(['p1']);
  assert.deepEqual(result, { success: false, code: 'BATCH_ORGANIZATION_FAILED' });
  assert.equal(JSON.stringify(result).includes('/Users/private/profile'), false);
});

test('mutation catches a rejecting batch coordinator without leaking its error', async () => {
  let apiCalls = 0;
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async () => { throw new Error('/Users/private/profile'); },
    assignProfilesWorkspace: async () => { apiCalls += 1; },
    setProfilesFavorite: async () => assert.fail('favorite must not run'),
    exportSelectedProfiles: async () => assert.fail('export must not run'),
    reloadProfiles: async () => assert.fail('failed batch must not reload profiles'),
  });
  const result = await batch.assignWorkspace(['p1'], 'w1');
  assert.deepEqual(result, { success: false, code: 'BATCH_ORGANIZATION_FAILED' });
  assert.equal(JSON.stringify(result).includes('/Users/private/profile'), false);
  assert.equal(apiCalls, 0);
});

test('export catches a rejecting batch coordinator without leaking its error', async () => {
  let apiCalls = 0;
  const batch = organizer.createProfileBatchOrganizer({
    runBatch: async () => { throw new Error('/Users/private/profile'); },
    assignProfilesWorkspace: async () => assert.fail('workspace mutation must not run'),
    setProfilesFavorite: async () => assert.fail('favorite must not run'),
    exportSelectedProfiles: async () => { apiCalls += 1; },
    reloadProfiles: async () => assert.fail('export must not reload profiles'),
  });
  const result = await batch.exportSelected(['p1']);
  assert.deepEqual(result, { success: false, code: 'BATCH_ORGANIZATION_FAILED' });
  assert.equal(JSON.stringify(result).includes('/Users/private/profile'), false);
  assert.equal(apiCalls, 0);
});
