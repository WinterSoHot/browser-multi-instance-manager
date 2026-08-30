const test = require('node:test');
const assert = require('node:assert/strict');

let viewUtils = {};
try {
  viewUtils = require('../renderer/view-utils');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('escapes text for both HTML text and attribute contexts', () => {
  assert.equal(
    viewUtils.escapeHtml?.(`<img src=x onerror="alert('x')">`),
    '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;',
  );
});
test('summarizes actual batch outcomes instead of attempted operations', () => {
  assert.deepEqual(
    viewUtils.summarizeResults?.([
      { success: true },
      { success: false, error: 'not found' },
      { success: true },
    ]),
    { successCount: 2, failureCount: 1, errors: ['not found'] },
  );
});

test('hydrates running profile IDs when a renderer page loads', async () => {
  const profiles = [{ id: 'work' }, { id: 'personal' }, { id: 'closed' }];
  const statuses = { work: true, personal: true, closed: false };

  assert.deepEqual(
    await viewUtils.getRunningProfileIds?.(
      profiles,
      async (profileId) => ({ running: statuses[profileId] }),
    ),
    ['work', 'personal'],
  );
});

test('prevents overlapping executions of an asynchronous polling task', async () => {
  let releaseTask;
  let executionCount = 0;
  const poll = viewUtils.createNonOverlappingTask?.(async () => {
    executionCount += 1;
    await new Promise((resolve) => {
      releaseTask = resolve;
    });
  });

  const firstRun = poll();
  assert.equal(await poll(), false);
  assert.equal(executionCount, 1);

  releaseTask();
  assert.equal(await firstRun, true);

  const thirdRun = poll();
  assert.equal(executionCount, 2);
  releaseTask();
  await thirdRun;
});

test('filters profiles once and limits selection to visible browser matches', () => {
  const profiles = [
    { id: '1', browserType: 'chrome', name: 'Work' },
    { id: '2', browserType: 'firefox', name: 'Work' },
    { id: '3', browserType: 'chrome', name: 'Personal' },
  ];

  assert.deepEqual(
    viewUtils.filterProfiles?.(profiles, 'chrome', ' wo '),
    [profiles[0]],
  );
});

test('runs bulk work with a fixed concurrency limit and preserves result order', async () => {
  let active = 0;
  let peak = 0;
  const releases = [];
  const progress = [];
  const operation = viewUtils.mapWithConcurrency?.(
    [1, 2, 3, 4, 5],
    2,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return value * 10;
    },
    (completed, total) => progress.push([completed, total]),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  while (releases.length > 0) {
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(await operation, [10, 20, 30, 40, 50]);
  assert.deepEqual(progress.at(-1), [5, 5]);
});

test('normalizes bulk statuses without treating unknown recovered processes as running', () => {
  assert.deepEqual(
    viewUtils.normalizeStatusSnapshot?.({
      work: { running: true },
      stale: { running: true, verificationUnavailable: true },
      closed: { running: false },
    }),
    { runningIds: ['work'], unknownIds: ['stale'] },
  );
});

test('limits long batch error summaries', () => {
  assert.equal(
    viewUtils.formatBatchErrors?.(['one', 'two', 'three', 'four'], 2),
    'one；two；另有 2 个错误',
  );
});
