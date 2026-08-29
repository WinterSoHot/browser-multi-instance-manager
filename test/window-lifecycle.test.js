const test = require('node:test');
const assert = require('node:assert/strict');

let windowLifecycle = {};
try {
  windowLifecycle = require('../lib/window-lifecycle');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('waits for initialization and creates at most one application window', async () => {
  let finishInitialization;
  let windowCount = 0;
  const initializationPromise = new Promise((resolve) => {
    finishInitialization = resolve;
  });
  const ensureWindow = () => windowLifecycle.createWindowAfterInitialization?.({
    initializationPromise,
    getWindows: () => Array.from({ length: windowCount }),
    createWindow: () => {
      windowCount += 1;
    },
  });

  const initialCreation = ensureWindow();
  const activationCreation = ensureWindow();
  assert.equal(windowCount, 0);

  finishInitialization();
  await Promise.all([initialCreation, activationCreation]);
  assert.equal(windowCount, 1);
});
