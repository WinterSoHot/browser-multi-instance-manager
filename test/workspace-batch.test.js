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
  assert.equal(result.summary.details, 'failed-running；另有 1 个错误');
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
