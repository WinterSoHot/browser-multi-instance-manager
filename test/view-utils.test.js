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

test('coalesces duplicate refreshes and runs one trailing refresh', async () => {
  const releases = [];
  let executionCount = 0;
  const refresh = viewUtils.createSingleFlightTask?.(async () => {
    executionCount += 1;
    await new Promise((resolve) => releases.push(resolve));
    return `updated-${executionCount}`;
  });

  const first = refresh();
  const second = refresh();
  assert.equal(first, second);
  assert.equal(executionCount, 1);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executionCount, 2);
  releases.shift()();
  assert.equal(await second, 'updated-2');
});

test('runs a requested trailing refresh even when the first refresh fails', async () => {
  let attempts = 0;
  let rejectFirst;
  const refresh = viewUtils.createSingleFlightTask?.(async () => {
    attempts += 1;
    if (attempts === 1) {
      await new Promise((resolve, reject) => {
        rejectFirst = reject;
      });
    }
    return 'recovered';
  });

  const first = refresh();
  const second = refresh();
  rejectFirst(new Error('temporary failure'));

  assert.equal(await second, 'recovered');
  assert.equal(await first, 'recovered');
  assert.equal(attempts, 2);
});

test('chunks large renderer requests without dropping items', () => {
  const items = Array.from({ length: 1001 }, (_, index) => index);
  const chunks = viewUtils.chunkItems?.(items, 500);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [500, 500, 1]);
  assert.deepEqual(chunks.flat(), items);
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

test('drops hidden selections when the active filter changes', () => {
  assert.deepEqual(
    [...(viewUtils.retainVisibleSelection?.(
      new Set(['chrome-work', 'firefox-work']),
      [{ id: 'chrome-work' }],
    ) || [])],
    ['chrome-work'],
  );
});

test('sorts profiles deterministically across name, creation, recent use, and status', () => {
  const profiles = [
    {
      id: 'p3',
      name: '  Zulu ',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLaunchedAt: null,
    },
    {
      id: 'p2',
      name: 'alpha',
      createdAt: '2026-01-03T00:00:00.000Z',
      lastLaunchedAt: '2026-01-05T00:00:00.000Z',
    },
    {
      id: 'p1',
      name: 'Bravo',
      createdAt: '2026-01-02T00:00:00.000Z',
      lastLaunchedAt: '2026-01-04T00:00:00.000Z',
    },
    {
      id: 'p4',
      name: 'ALPHA',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLaunchedAt: '2026-01-05T00:00:00.000Z',
    },
  ];
  const statusSnapshot = {
    runningIds: ['p1'],
    unknownIds: ['p2'],
  };

  assert.deepEqual(
    viewUtils.sortProfiles?.(profiles, 'name', statusSnapshot).map((profile) => profile.id),
    ['p2', 'p4', 'p1', 'p3'],
  );
  assert.deepEqual(
    viewUtils.sortProfiles?.(profiles, 'created-desc', statusSnapshot).map((profile) => profile.id),
    ['p2', 'p1', 'p4', 'p3'],
  );
  assert.deepEqual(
    viewUtils.sortProfiles?.(profiles, 'recent-desc', statusSnapshot).map((profile) => profile.id),
    ['p2', 'p4', 'p1', 'p3'],
  );
  assert.deepEqual(
    viewUtils.sortProfiles?.(profiles, 'status', statusSnapshot).map((profile) => profile.id),
    ['p1', 'p2', 'p4', 'p3'],
  );
  assert.deepEqual(profiles.map((profile) => profile.id), ['p3', 'p2', 'p1', 'p4']);
});

test('creation sorting places invalid and missing timestamps after every valid date', () => {
  const profiles = [
    { id: 'invalid', name: 'Alpha', createdAt: 'not-a-date' },
    { id: 'epoch', name: 'Bravo', createdAt: '1970-01-01T00:00:00.000Z' },
    { id: 'missing', name: 'Charlie' },
    { id: 'before-epoch', name: 'Delta', createdAt: '1960-01-01T00:00:00.000Z' },
  ];

  assert.deepEqual(
    viewUtils.sortProfiles?.(profiles, 'created-desc', {}).map((profile) => profile.id),
    ['epoch', 'before-epoch', 'invalid', 'missing'],
  );
});

test('treats all editable controls as keyboard shortcut boundaries', () => {
  assert.equal(viewUtils.isEditableTarget?.({ tagName: 'INPUT' }), true);
  assert.equal(viewUtils.isEditableTarget?.({ tagName: 'TEXTAREA' }), true);
  assert.equal(viewUtils.isEditableTarget?.({ tagName: 'SELECT' }), true);
  assert.equal(viewUtils.isEditableTarget?.({ tagName: 'BUTTON' }), true);
  assert.equal(viewUtils.isEditableTarget?.({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(viewUtils.isEditableTarget?.({ tagName: 'DIV', isContentEditable: false }), false);
});

test('does not treat an assignment select as a profile-card selection click', () => {
  assert.equal(viewUtils.shouldToggleProfileCardSelection?.({ tagName: 'SELECT' }), false);
  assert.equal(viewUtils.shouldToggleProfileCardSelection?.({ tagName: 'DIV' }), true);
});

test('does not select a card when a label wraps a workspace select', () => {
  const label = { tagName: 'LABEL' };
  const select = {
    tagName: 'SELECT',
    closest(selector) {
      return selector.includes('label') ? label : null;
    },
  };
  const labelText = {
    tagName: 'SPAN',
    closest(selector) {
      return selector.includes('label') ? label : null;
    },
  };

  assert.equal(viewUtils.shouldToggleProfileCardSelection?.(select), false);
  assert.equal(viewUtils.shouldToggleProfileCardSelection?.(labelText), false);
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
      retryable: {
        running: true,
        verificationUnavailable: true,
        closeRetryAvailable: true,
      },
      closed: { running: false },
    }),
    {
      runningIds: ['work'],
      unknownIds: ['stale', 'retryable'],
      retryableCloseIds: ['retryable'],
    },
  );
});

test('builds isolated set membership for one renderer status pass', () => {
  const snapshot = {
    runningIds: ['running'],
    unknownIds: ['unknown'],
    retryableCloseIds: ['unknown'],
  };

  const membership = viewUtils.createStatusMembership(snapshot);

  assert.equal(membership.runningIds.has('running'), true);
  assert.equal(membership.runningIds.has('unknown'), false);
  assert.equal(membership.unknownIds.has('unknown'), true);
  assert.equal(membership.retryableCloseIds.has('unknown'), true);

  snapshot.runningIds.push('added-after-pass');
  assert.equal(membership.runningIds.has('added-after-pass'), false);
});

test('maps retryable unknown status to the safe close action', () => {
  assert.deepEqual(
    viewUtils.getUnknownStatusPrimaryAction?.(true),
    { action: 'closeBrowserOnly', label: '重试关闭', className: 'btn-danger' },
  );
  assert.deepEqual(
    viewUtils.getUnknownStatusPrimaryAction?.(false),
    { action: 'refresh-status', label: '重试', className: 'btn-warning' },
  );
});

test('includes retryable unknown profiles in bulk close selection', () => {
  assert.deepEqual(
    viewUtils.filterCloseableProfileIds?.(
      ['running', 'retryable', 'stopped'],
      new Set(['running']),
      new Set(['retryable']),
    ),
    ['running', 'retryable'],
  );
});

test('limits long batch error summaries', () => {
  assert.equal(
    viewUtils.formatBatchErrors?.(['one', 'two', 'three', 'four'], 2),
    'one；two；另有 2 个错误',
  );
});
