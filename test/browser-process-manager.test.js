const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

let processModule = {};
try {
  processModule = require('../lib/browser-process-manager');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

class FakeChild extends EventEmitter {
  constructor(pid = 4321) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.unrefCalled = false;
  }

  unref() {
    this.unrefCalled = true;
  }

  kill(signal) {
    this.signalCode = signal;
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit('exit', 0, signal);
    });
    return true;
  }
}

test('uses profile-isolated arguments for Chromium and Firefox browsers', () => {
  assert.deepEqual(
    processModule.buildBrowserArgs?.('chrome', '/profiles/work'),
    ['--user-data-dir=/profiles/work'],
  );
  assert.deepEqual(
    processModule.buildBrowserArgs?.('firefox', '/profiles/work'),
    ['-no-remote', '-profile', '/profiles/work'],
  );
});

test('tracks the exact spawned child for each profile', async () => {
  const child = new FakeChild();
  const calls = [];
  const manager = new processModule.BrowserProcessManager({
    spawnProcess(executablePath, args, options) {
      calls.push({ executablePath, args, options });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });

  const result = await manager.launch({
    profileId: 'profile-1',
    browserType: 'edge',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Microsoft Edge',
  });

  assert.deepEqual(result, { success: true, pid: 4321 });
  assert.equal(manager.isRunning('profile-1'), true);
  assert.equal(child.unrefCalled, true);
  assert.deepEqual(calls, [{
    executablePath: '/Applications/Microsoft Edge',
    args: ['--user-data-dir=/profiles/work'],
    options: { detached: true, stdio: 'ignore' },
  }]);
});

test('reports launch errors instead of returning success early', async () => {
  const child = new FakeChild();
  const manager = new processModule.BrowserProcessManager({
    spawnProcess() {
      queueMicrotask(() => child.emit('error', new Error('permission denied')));
      return child;
    },
  });

  const result = await manager.launch({
    profileId: 'profile-1',
    browserType: 'chrome',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Chrome',
  });

  assert.deepEqual(result, { success: false, error: 'permission denied' });
  assert.equal(manager.isRunning('profile-1'), false);
});

test('waits for the tracked child to exit before reporting close success', async () => {
  const child = new FakeChild();
  const manager = new processModule.BrowserProcessManager({
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });

  await manager.launch({
    profileId: 'profile-1',
    browserType: 'zen',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Zen',
  });
  const result = await manager.close('profile-1');

  assert.deepEqual(result, { success: true });
  assert.equal(child.signalCode, 'SIGTERM');
  assert.equal(manager.isRunning('profile-1'), false);
});

test('reserves a profile while its browser is still starting', async () => {
  const firstChild = new FakeChild(1001);
  const secondChild = new FakeChild(1002);
  let spawnCount = 0;
  const manager = new processModule.BrowserProcessManager({
    spawnProcess() {
      spawnCount += 1;
      if (spawnCount === 2) {
        queueMicrotask(() => secondChild.emit('spawn'));
        return secondChild;
      }
      return firstChild;
    },
  });
  const launchRequest = {
    profileId: 'profile-1',
    browserType: 'chrome',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Chrome',
  };

  const firstLaunch = manager.launch(launchRequest);
  const runningWhilePending = manager.isRunning('profile-1');
  const closeWhilePending = await manager.close('profile-1');
  const secondResult = await manager.launch(launchRequest);
  firstChild.emit('spawn');
  const firstResult = await firstLaunch;

  assert.deepEqual(secondResult, { success: false, error: 'Browser already running' });
  assert.equal(spawnCount, 1);
  assert.equal(runningWhilePending, true);
  assert.deepEqual(
    closeWhilePending,
    { success: false, error: 'Browser is still starting' },
  );
  assert.deepEqual(firstResult, { success: true, pid: 1001 });
});
