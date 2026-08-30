const test = require('node:test');
const assert = require('node:assert/strict');

let workspaceBatch = {};
try {
  workspaceBatch = require('../renderer/workspace-batch');
} catch {
  // The first TDD run intentionally exercises the missing batch module.
}

function profile(id) {
  return { id, browserType: 'chrome', name: id };
}

test('launch workspace batch uses one forced snapshot, skips unknown targets, and caps work at four', async () => {
  const statusCalls = [];
  const launches = [];
  let active = 0;
  let peak = 0;
  const results = await workspaceBatch.executeWorkspaceBatch?.({
    action: 'launch',
    profiles: [profile('stopped-1'), profile('running'), profile('unknown'), profile('stopped-2'), profile('stopped-3'), profile('stopped-4'), profile('stopped-5')],
    getBrowserStatuses(profileIds, options) {
      statusCalls.push({ profileIds, options });
      return {
        'stopped-1': { running: false },
        running: { running: true },
        unknown: { verificationUnavailable: true },
        'stopped-2': { running: false },
        'stopped-3': { running: false },
        'stopped-4': { running: false },
        'stopped-5': { running: false },
      };
    },
    async launchBrowser(profileId) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      launches.push(profileId);
      return { success: true };
    },
    closeBrowser: () => assert.fail('close must not run for launch'),
  });

  assert.deepEqual(statusCalls, [{
    profileIds: ['stopped-1', 'running', 'unknown', 'stopped-2', 'stopped-3', 'stopped-4', 'stopped-5'],
    options: { force: true },
  }]);
  assert.deepEqual(launches.sort(), ['stopped-1', 'stopped-2', 'stopped-3', 'stopped-4', 'stopped-5']);
  assert.equal(peak, 4);
  assert.deepEqual(results.targetIds, ['stopped-1', 'stopped-2', 'stopped-3', 'stopped-4', 'stopped-5']);
});

test('close workspace batch includes only running and retryable unknown targets with bounded failures', async () => {
  const closed = [];
  const result = await workspaceBatch.executeWorkspaceBatch?.({
    action: 'close',
    profiles: [profile('running'), profile('unknown'), profile('retryable'), profile('stopped')],
    getBrowserStatuses: () => ({
      running: { running: true },
      unknown: { verificationUnavailable: true },
      retryable: { verificationUnavailable: true, closeRetryAvailable: true },
      stopped: { running: false },
    }),
    launchBrowser: () => assert.fail('launch must not run for close'),
    closeBrowser(profileId) {
      closed.push(profileId);
      return { success: false, error: `failed-${profileId}` };
    },
  });

  assert.deepEqual(closed, ['running', 'retryable']);
  assert.equal(result.summary.successCount, 0);
  assert.equal(result.summary.failureCount, 2);
  assert.equal(result.summary.details, '请求失败；另有 1 个错误');
});

test('workspace batch runner rejects re-entry while the current batch is active', async () => {
  let release;
  const runner = workspaceBatch.createWorkspaceBatchRunner?.(async () => {
    await new Promise((resolve) => { release = resolve; });
    return { success: true };
  });

  const first = runner();
  assert.deepEqual(await runner(), { skipped: true });
  release();
  assert.deepEqual(await first, { success: true });
});

test('page batch coordinator blocks selected work during a workspace batch', async () => {
  const busyChanges = [];
  let releaseWorkspace;
  const coordinator = workspaceBatch.createPageBatchCoordinator?.(
    (busy) => busyChanges.push(busy),
  );
  const workspaceRun = coordinator.run(async () => {
    await new Promise((resolve) => { releaseWorkspace = resolve; });
    return { kind: 'workspace' };
  });

  assert.deepEqual(await coordinator.run(() => ({ kind: 'selected' })), {
    skipped: true,
    code: 'BATCH_ALREADY_RUNNING',
  });
  releaseWorkspace();
  assert.deepEqual(await workspaceRun, { kind: 'workspace' });
  assert.deepEqual(busyChanges, [true, false]);
});

test('page batch coordinator blocks workspace work during a selected batch and restores after failure', async () => {
  const busyChanges = [];
  let releaseSelected;
  const coordinator = workspaceBatch.createPageBatchCoordinator?.(
    (busy) => busyChanges.push(busy),
  );
  const selectedRun = coordinator.run(async () => {
    await new Promise((resolve) => { releaseSelected = resolve; });
    throw new Error('selected failed');
  });

  assert.deepEqual(await coordinator.run(() => ({ kind: 'workspace' })), {
    skipped: true,
    code: 'BATCH_ALREADY_RUNNING',
  });
  releaseSelected();
  await assert.rejects(selectedRun, /selected failed/u);
  assert.deepEqual(busyChanges, [true, false]);
  assert.deepEqual(await coordinator.run(() => ({ kind: 'workspace' })), {
    kind: 'workspace',
  });
  assert.deepEqual(busyChanges, [true, false, true, false]);
});

test('launch metadata warnings remain successful batch outcomes', async () => {
  const result = await workspaceBatch.executeWorkspaceBatch?.({
    action: 'launch',
    profiles: [profile('warning')],
    getBrowserStatuses: () => ({ warning: { running: false } }),
    launchBrowser: async () => ({
      success: true,
      pid: 42,
      warningCode: 'LAST_LAUNCHED_AT_NOT_RECORDED',
    }),
    closeBrowser: () => assert.fail('close must not run for launch'),
  });

  assert.equal(result.summary.successCount, 1);
  assert.equal(result.summary.failureCount, 0);
});

test('workspace batch replaces rejected and resolved raw errors with fixed messages', async () => {
  const secrets = ['/Users/secret/profile', 'C:\\Users\\secret\\browser.exe'];
  const result = await workspaceBatch.executeWorkspaceBatch?.({
    action: 'launch',
    profiles: [profile('rejected'), profile('resolved')],
    getBrowserStatuses: () => ({
      rejected: { running: false },
      resolved: { running: false },
    }),
    launchBrowser: async (profileId) => {
      if (profileId === 'rejected') throw new Error(secrets[0]);
      return { success: false, error: secrets[1], pid: 991 };
    },
    closeBrowser: () => assert.fail('close must not run for launch'),
  });

  assert.deepEqual(result.results, [
    { success: false, code: 'BATCH_OPERATION_FAILED', error: '请求失败' },
    { success: false, code: 'BATCH_OPERATION_FAILED', error: '请求失败' },
  ]);
  assert.equal(result.summary.details, '请求失败；另有 1 个错误');
  const serialized = JSON.stringify(result);
  secrets.forEach((secret) => assert.equal(serialized.includes(secret), false));
  assert.equal(serialized.includes('991'), false);
});

test('workspace batch fails closed when its forced snapshot cannot be read', async () => {
  let operationCount = 0;
  const result = await workspaceBatch.executeWorkspaceBatch?.({
    action: 'launch',
    profiles: [profile('unknown-status')],
    getBrowserStatuses: async () => { throw new Error('status unavailable'); },
    launchBrowser: async () => { operationCount += 1; },
    closeBrowser: async () => { operationCount += 1; },
  });

  assert.equal(operationCount, 0);
  assert.deepEqual(result.targetIds, []);
});
