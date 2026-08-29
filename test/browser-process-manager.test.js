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

const persistedRecord = {
  profileId: 'profile-1',
  browserType: 'chrome',
  profilePath: '/profiles/work',
  executablePath: '/Applications/Chrome',
  pid: 2001,
};

test('persists serializable process records after launch and exit', async () => {
  const child = new FakeChild(2001);
  const snapshots = [];
  const manager = new processModule.BrowserProcessManager({
    onStateChange(records) {
      snapshots.push(records);
    },
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });

  await manager.launch({ ...persistedRecord, executablePath: '/Applications/Chrome' });
  assert.deepEqual(manager.getPersistedRecords?.(), [persistedRecord]);

  child.exitCode = 0;
  child.emit('exit', 0, null);
  assert.deepEqual(snapshots.at(-1), []);
});

test('restores only persisted processes that still match their command line', async () => {
  const snapshots = [];
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess(record) {
      return record.pid === 2001;
    },
    onStateChange(records) {
      snapshots.push(records);
    },
  });

  const restoredIds = await manager.restore?.([
    persistedRecord,
    { ...persistedRecord, profileId: 'stale', pid: 9999 },
  ]);

  assert.deepEqual(restoredIds, ['profile-1']);
  assert.deepEqual(await manager.getStatus('profile-1'), { running: true });
  assert.deepEqual(await manager.getStatus('stale'), { running: false });
  assert.deepEqual(snapshots.at(-1), [persistedRecord]);
});

test('removes a recovered process when later verification detects PID reuse', async () => {
  let matchesCommand = true;
  const snapshots = [];
  const manager = new processModule.BrowserProcessManager({
    verificationCacheMs: 0,
    async verifyProcess() {
      return matchesCommand;
    },
    onStateChange(records) {
      snapshots.push(records);
    },
  });

  await manager.restore?.([persistedRecord]);
  matchesCommand = false;

  assert.deepEqual(await manager.getStatus('profile-1'), { running: false });
  assert.deepEqual(snapshots.at(-1), []);
});

test('caches recent recovered-process verification between status polls', async () => {
  let currentTime = 1000;
  let verificationCount = 0;
  const manager = new processModule.BrowserProcessManager({
    now: () => currentTime,
    verificationCacheMs: 4000,
    async verifyProcess() {
      verificationCount += 1;
      return true;
    },
  });

  await manager.restore?.([persistedRecord]);
  await manager.getStatus('profile-1');
  currentTime = 3000;
  await manager.getStatus('profile-1');
  assert.equal(verificationCount, 1);

  currentTime = 6000;
  await manager.getStatus('profile-1');
  assert.equal(verificationCount, 2);
});

test('allows destructive operations to bypass the verification cache', async () => {
  let matchesCommand = true;
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return matchesCommand;
    },
  });

  await manager.restore?.([persistedRecord]);
  matchesCommand = false;

  assert.deepEqual(
    await manager.getStatus('profile-1', { force: true }),
    { running: false },
  );
});

test('preserves a recovered record when process inspection is temporarily unavailable', async () => {
  const snapshots = [];
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return 'unavailable';
    },
    onStateChange(records) {
      snapshots.push(records);
    },
  });

  assert.deepEqual(await manager.restore?.([persistedRecord]), ['profile-1']);
  assert.deepEqual(
    await manager.getStatus('profile-1', { force: true }),
    { running: true, verificationUnavailable: true },
  );
  assert.deepEqual(snapshots.at(-1), [persistedRecord]);
});

test('does not signal or forget a recovered process when inspection is unavailable', async () => {
  let verificationResult = 'verified';
  const signals = [];
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return verificationResult;
    },
    terminateProcess(pid, signal) {
      signals.push({ pid, signal });
      return true;
    },
  });

  await manager.restore?.([persistedRecord]);
  verificationResult = 'unavailable';

  assert.deepEqual(
    await manager.close('profile-1'),
    { success: false, error: 'Unable to verify browser process' },
  );
  assert.deepEqual(signals, []);
  assert.deepEqual(manager.getPersistedRecords(), [persistedRecord]);
});

test('closes and forgets a recovered browser process', async () => {
  let active = true;
  const signals = [];
  const snapshots = [];
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return active;
    },
    onStateChange(records) {
      snapshots.push(records);
    },
    terminateProcess(pid, signal) {
      signals.push({ pid, signal });
      active = false;
      return true;
    },
  });

  await manager.restore?.([persistedRecord]);
  const result = await manager.close('profile-1');

  assert.deepEqual(result, { success: true });
  assert.deepEqual(signals, [{ pid: 2001, signal: 'SIGTERM' }]);
  assert.deepEqual(snapshots.at(-1), []);
});

test('does not signal a recovered PID after its command no longer matches', async () => {
  let matchesCommand = true;
  const signals = [];
  const snapshots = [];
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return matchesCommand;
    },
    terminateProcess(pid, signal) {
      signals.push({ pid, signal });
      return true;
    },
    onStateChange(records) {
      snapshots.push(records);
    },
  });

  await manager.restore?.([persistedRecord]);
  matchesCommand = false;
  const result = await manager.close('profile-1');

  assert.deepEqual(result, { success: false, error: 'Browser not running' });
  assert.deepEqual(signals, []);
  assert.deepEqual(snapshots.at(-1), []);
});
