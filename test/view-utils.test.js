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
