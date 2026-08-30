const test = require('node:test');
const assert = require('node:assert/strict');

let appLifecycle = {};
try {
  appLifecycle = require('../lib/app-lifecycle');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

const createAppLifecycle = appLifecycle.createAppLifecycle || (() => ({
  handleWindowClose: async () => false,
  handleBeforeQuit: async () => false,
  requestQuit: async () => false,
  isQuitting: () => false,
}));

function createCancelableEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createLifecycle({
  platform = 'darwin',
  closeToTray = true,
  counts = { running: 0, unknown: 0 },
  getActiveStatusCount,
  confirmResult = true,
  destroyTray,
} = {}) {
  let hideCalls = 0;
  let confirmCalls = 0;
  let destroyCalls = 0;
  let quitCalls = 0;
  const forcedSnapshotOptions = [];
  const confirmedCounts = [];
  const lifecycle = createAppLifecycle({
    platform,
    getCloseToTray: () => closeToTray,
    getActiveStatusCount: getActiveStatusCount || ((options) => {
      forcedSnapshotOptions.push(options);
      return counts;
    }),
    confirmExit: async (activeCounts) => {
      confirmCalls += 1;
      confirmedCounts.push(activeCounts);
      return confirmResult;
    },
    hideWindow: () => {
      hideCalls += 1;
    },
    destroyTray: destroyTray || (() => {
      destroyCalls += 1;
    }),
    quitApp: () => {
      quitCalls += 1;
    },
  });

  return {
    lifecycle,
    get hideCalls() {
      return hideCalls;
    },
    get confirmCalls() {
      return confirmCalls;
    },
    get destroyCalls() {
      return destroyCalls;
    },
    get quitCalls() {
      return quitCalls;
    },
    forcedSnapshotOptions,
    confirmedCounts,
  };
}

test('window close hides immediately when close-to-tray is enabled', async () => {
  const harness = createLifecycle();
  const event = createCancelableEvent();

  const closeRequest = harness.lifecycle.handleWindowClose(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.hideCalls, 1);
  assert.equal(await closeRequest, false);
  assert.equal(harness.quitCalls, 0);
});

test('disabled close-to-tray preserves normal macOS window close behavior', async () => {
  const harness = createLifecycle({ closeToTray: false });
  const event = createCancelableEvent();

  assert.equal(await harness.lifecycle.handleWindowClose(event), false);
  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.hideCalls, 0);
  assert.equal(harness.quitCalls, 0);
});

for (const platform of ['win32', 'linux']) {
  test(`disabled close-to-tray routes ${platform} window close through the quit check`, async () => {
    const harness = createLifecycle({ platform, closeToTray: false });
    const event = createCancelableEvent();

    const closeRequest = harness.lifecycle.handleWindowClose(event);

    assert.equal(event.defaultPrevented, true);
    assert.equal(await closeRequest, true);
    assert.deepEqual(harness.forcedSnapshotOptions, [{ force: true }]);
    assert.equal(harness.quitCalls, 1);
  });
}

test('quit skips confirmation when forced snapshot has no running or unknown profiles', async () => {
  const harness = createLifecycle({ counts: { running: 0, unknown: 0 } });

  assert.equal(await harness.lifecycle.requestQuit(), true);
  assert.deepEqual(harness.forcedSnapshotOptions, [{ force: true }]);
  assert.equal(harness.confirmCalls, 0);
  assert.equal(harness.destroyCalls, 1);
  assert.equal(harness.quitCalls, 1);
  assert.equal(harness.lifecycle.isQuitting(), true);
});

for (const counts of [{ running: 2, unknown: 0 }, { running: 0, unknown: 1 }]) {
  test(`quit warns for active status counts ${JSON.stringify(counts)}`, async () => {
    const harness = createLifecycle({ counts });

    assert.equal(await harness.lifecycle.requestQuit(), true);
    assert.deepEqual(harness.confirmedCounts, [counts]);
    assert.equal(harness.quitCalls, 1);
  });
}

test('cancelled exit leaves the tray and application alive', async () => {
  const harness = createLifecycle({
    counts: { running: 1, unknown: 0 },
    confirmResult: false,
  });

  assert.equal(await harness.lifecycle.requestQuit(), false);
  assert.equal(harness.destroyCalls, 0);
  assert.equal(harness.quitCalls, 0);
  assert.equal(harness.lifecycle.isQuitting(), false);
});

test('snapshot failures fail closed with an unknown-status confirmation', async () => {
  const harness = createLifecycle({
    getActiveStatusCount: async () => {
      throw new Error('process probe failed');
    },
    confirmResult: false,
  });

  assert.equal(await harness.lifecycle.requestQuit(), false);
  assert.deepEqual(harness.confirmedCounts, [{ running: 0, unknown: 1 }]);
  assert.equal(harness.quitCalls, 0);
});

test('non-Error snapshot failures are also converted into an unknown-status warning', async () => {
  const harness = createLifecycle({
    getActiveStatusCount: async () => {
      throw 'unavailable';
    },
    confirmResult: false,
  });

  assert.equal(await harness.lifecycle.requestQuit(), false);
  assert.deepEqual(harness.confirmedCounts, [{ running: 0, unknown: 1 }]);
});

test('tray destruction errors do not prevent an approved application exit', async () => {
  let destroyCalls = 0;
  const harness = createLifecycle({
    destroyTray: async () => {
      destroyCalls += 1;
      throw new Error('tray already destroyed');
    },
  });

  assert.equal(await harness.lifecycle.requestQuit(), true);
  assert.equal(destroyCalls, 1);
  assert.equal(harness.quitCalls, 1);
  assert.equal(harness.lifecycle.isQuitting(), true);
});

test('repeated quit requests share one snapshot and confirmation', async () => {
  const snapshot = createDeferred();
  const harness = createLifecycle({
    getActiveStatusCount: () => snapshot.promise,
  });

  const firstRequest = harness.lifecycle.requestQuit();
  const secondRequest = harness.lifecycle.requestQuit();

  assert.strictEqual(firstRequest, secondRequest);
  snapshot.resolve({ running: 1, unknown: 0 });
  assert.equal(await firstRequest, true);
  assert.equal(harness.confirmCalls, 1);
  assert.equal(harness.quitCalls, 1);
});

test('before-quit prevents immediately and shares an in-flight quit request', async () => {
  const snapshot = createDeferred();
  const harness = createLifecycle({
    getActiveStatusCount: () => snapshot.promise,
  });
  const firstEvent = createCancelableEvent();
  const secondEvent = createCancelableEvent();

  const firstRequest = harness.lifecycle.handleBeforeQuit(firstEvent);
  const secondRequest = harness.lifecycle.handleBeforeQuit(secondEvent);

  assert.equal(firstEvent.defaultPrevented, true);
  assert.equal(secondEvent.defaultPrevented, true);
  assert.strictEqual(firstRequest, secondRequest);
  snapshot.resolve({ running: 0, unknown: 0 });
  assert.equal(await firstRequest, true);
  assert.equal(harness.quitCalls, 1);
});

test('before-quit passes through after an approved quit has set isQuitting', async () => {
  const harness = createLifecycle();
  await harness.lifecycle.requestQuit();
  const event = createCancelableEvent();

  assert.equal(await harness.lifecycle.handleBeforeQuit(event), true);
  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.quitCalls, 1);
});
