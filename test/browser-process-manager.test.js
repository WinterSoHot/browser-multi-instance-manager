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

test('does not report close success before tree termination succeeds', async () => {
  const child = new FakeChild();
  let finishTermination;
  const manager = new processModule.BrowserProcessManager({
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminateLaunchedProcess() {
      child.exitCode = 0;
      child.emit('exit', 0, 'SIGTERM');
      return new Promise((resolve) => {
        finishTermination = resolve;
      });
    },
  });
  await manager.launch({
    profileId: 'profile-1',
    browserType: 'chrome',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Chrome',
  });

  const closeRequest = manager.close('profile-1');
  await new Promise((resolve) => setImmediate(resolve));
  finishTermination(false);

  assert.deepEqual(
    await closeRequest,
    { success: false, error: 'Failed to signal browser process' },
  );
});

test('keeps app-launched close single-flight and reserves the profile until tree shutdown', async () => {
  const child = new FakeChild();
  let finishTermination;
  let terminationCalls = 0;
  const manager = new processModule.BrowserProcessManager({
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminateLaunchedProcess() {
      terminationCalls += 1;
      child.exitCode = 0;
      child.emit('exit', 0, 'SIGTERM');
      return new Promise((resolve) => {
        finishTermination = resolve;
      });
    },
  });
  const launchRequest = {
    profileId: 'profile-1',
    browserType: 'chrome',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Chrome',
  };
  await manager.launch(launchRequest);

  const firstClose = manager.close('profile-1');
  const secondClose = manager.close('profile-1');
  await new Promise((resolve) => setImmediate(resolve));
  const relaunch = await manager.launch(launchRequest);

  assert.equal(firstClose, secondClose);
  assert.equal(terminationCalls, 1);
  assert.deepEqual(relaunch, { success: false, error: 'Browser already running' });
  finishTermination(true);
  assert.deepEqual(await firstClose, { success: true });
});

test('keeps a profile reserved while tree termination exceeds the manager timeout', async () => {
  const child = new FakeChild();
  let finishTermination;
  const manager = new processModule.BrowserProcessManager({
    closeTimeoutMs: 5,
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminateLaunchedProcess() {
      child.exitCode = 0;
      child.emit('exit', 0, 'SIGTERM');
      return new Promise((resolve) => {
        finishTermination = resolve;
      });
    },
  });
  const launchRequest = {
    profileId: 'profile-1',
    browserType: 'chrome',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Chrome',
  };
  await manager.launch(launchRequest);

  const closeRequest = manager.close('profile-1');
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(manager.isRunning('profile-1'), true);
  assert.deepEqual(
    await manager.launch(launchRequest),
    { success: false, error: 'Browser already running' },
  );

  finishTermination(true);
  assert.deepEqual(await closeRequest, { success: true });
});

test('keeps failed tree termination occupied until a close retry succeeds', async () => {
  const child = new FakeChild();
  let terminationCalls = 0;
  const manager = new processModule.BrowserProcessManager({
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminateLaunchedProcess() {
      terminationCalls += 1;
      child.exitCode = 0;
      child.emit('exit', 0, 'SIGTERM');
      return terminationCalls > 1;
    },
  });
  const launchRequest = {
    profileId: 'profile-1',
    browserType: 'chrome',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Chrome',
  };
  await manager.launch(launchRequest);

  assert.deepEqual(
    await manager.close('profile-1'),
    { success: false, error: 'Failed to signal browser process' },
  );
  assert.equal(manager.isRunning('profile-1'), true);
  assert.deepEqual(
    await manager.getStatus('profile-1'),
    {
      running: true,
      verificationUnavailable: true,
      closeRetryAvailable: true,
    },
  );
  assert.deepEqual(
    await manager.launch(launchRequest),
    { success: false, error: 'Browser already running' },
  );

  assert.deepEqual(await manager.close('profile-1'), { success: true });
  assert.equal(terminationCalls, 2);
  assert.equal(manager.isRunning('profile-1'), false);
});

test('preserves uncertain tree termination across restart until explicitly forgotten', async () => {
  const child = new FakeChild(2001);
  const firstManager = new processModule.BrowserProcessManager({
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminateLaunchedProcess() {
      child.exitCode = 0;
      child.emit('exit', 0, 'SIGTERM');
      return false;
    },
  });
  await firstManager.launch(persistedRecord);
  await firstManager.close('profile-1');

  const savedRecords = firstManager.getPersistedRecords();
  assert.deepEqual(savedRecords, [{ ...persistedRecord, terminationUncertain: true }]);

  let verificationCalls = 0;
  const restoredManager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      verificationCalls += 1;
      return 'mismatch';
    },
  });
  assert.deepEqual(await restoredManager.restore(savedRecords), ['profile-1']);
  assert.equal(verificationCalls, 0);
  assert.deepEqual(
    await restoredManager.getStatus('profile-1'),
    { running: true, verificationUnavailable: true },
  );
  assert.deepEqual(
    await restoredManager.forget('profile-1'),
    { success: false, error: 'Confirmation required to clear a possibly running process record' },
  );
  assert.deepEqual(
    await restoredManager.forget('profile-1', { acknowledgePossibleRunning: true }),
    { success: true },
  );
  assert.equal(restoredManager.isRunning('profile-1'), false);
  assert.deepEqual(restoredManager.getPersistedRecords(), []);
});

test('persists shutdown occupancy while tree termination is still pending', async () => {
  const child = new FakeChild(2001);
  let finishTermination;
  const snapshots = [];
  const manager = new processModule.BrowserProcessManager({
    onStateChange(records) {
      snapshots.push(records);
    },
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminateLaunchedProcess() {
      child.exitCode = 0;
      child.emit('exit', 0, 'SIGTERM');
      return new Promise((resolve) => {
        finishTermination = resolve;
      });
    },
  });
  await manager.launch(persistedRecord);

  const closeRequest = manager.close('profile-1');
  await new Promise((resolve) => setImmediate(resolve));
  const pendingRecord = { ...persistedRecord, terminationUncertain: true };

  assert.deepEqual(manager.getPersistedRecords(), [pendingRecord]);
  assert.deepEqual(snapshots.at(-1), [pendingRecord]);

  const restoredManager = new processModule.BrowserProcessManager();
  assert.deepEqual(await restoredManager.restore([pendingRecord]), ['profile-1']);
  assert.deepEqual(
    await restoredManager.getStatus('profile-1'),
    { running: true, verificationUnavailable: true },
  );

  finishTermination(true);
  assert.deepEqual(await closeRequest, { success: true });
  assert.deepEqual(manager.getPersistedRecords(), []);
  assert.deepEqual(snapshots.at(-1), []);
});

test('fails closed when a persisted uncertainty marker is malformed', async () => {
  let verificationCalls = 0;
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      verificationCalls += 1;
      return 'mismatch';
    },
  });

  assert.deepEqual(await manager.restore([{
    ...persistedRecord,
    terminationUncertain: 'corrupt',
  }]), ['profile-1']);
  assert.equal(verificationCalls, 0);
  assert.equal(manager.isRunning('profile-1'), true);
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

test('returns one status snapshot for all requested profiles', async () => {
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess(record) {
      return record.profileId === 'profile-1' ? 'verified' : 'unavailable';
    },
  });
  await manager.restore?.([
    persistedRecord,
    { ...persistedRecord, profileId: 'unknown', pid: 2002 },
  ]);

  assert.deepEqual(
    await manager.getStatuses?.(['profile-1', 'unknown', 'closed'], { force: true }),
    {
      'profile-1': { running: true },
      unknown: { running: true, verificationUnavailable: true },
      closed: { running: false },
    },
  );
});

test('requires explicit acknowledgement before forgetting a possibly running process', async () => {
  const snapshots = [];
  const signals = [];
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return 'unavailable';
    },
    onStateChange(records) {
      snapshots.push(records);
    },
    terminateProcess(pid) {
      signals.push(pid);
      return true;
    },
  });
  await manager.restore?.([persistedRecord]);

  assert.deepEqual(
    await manager.forget?.('profile-1'),
    { success: false, error: 'Confirmation required to clear a possibly running process record' },
  );
  assert.deepEqual(manager.getPersistedRecords(), [persistedRecord]);

  assert.deepEqual(
    await manager.forget?.('profile-1', { acknowledgePossibleRunning: true }),
    { success: true },
  );
  assert.deepEqual(signals, []);
  assert.deepEqual(snapshots.at(-1), []);
  assert.deepEqual(await manager.getStatus('profile-1'), { running: false });
});

test('does not forget a browser child that this application launched', async () => {
  const child = new FakeChild();
  const manager = new processModule.BrowserProcessManager({
    spawnProcess() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  await manager.launch({
    profileId: 'profile-1',
    browserType: 'chrome',
    profilePath: '/profiles/work',
    executablePath: '/Applications/Chrome',
  });

  assert.deepEqual(
    await manager.forget?.('profile-1'),
    { success: false, error: 'Close the browser before forgetting its process' },
  );
});

test('uses one verifier snapshot for multiple recovered statuses', async () => {
  let bulkCalls = 0;
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return 'verified';
    },
    async verifyProcesses(records) {
      bulkCalls += 1;
      return Object.fromEntries(records.map((record) => [record.profileId, 'verified']));
    },
  });
  await manager.restore([
    persistedRecord,
    { ...persistedRecord, profileId: 'profile-2', pid: 2002 },
  ]);
  bulkCalls = 0;

  assert.deepEqual(
    await manager.getStatuses(['profile-1', 'profile-2'], { force: true }),
    {
      'profile-1': { running: true },
      'profile-2': { running: true },
    },
  );
  assert.equal(bulkCalls, 1);
});

test('shares an in-flight bulk verification across concurrent status requests', async () => {
  let releaseVerification;
  let bulkCalls = 0;
  const manager = new processModule.BrowserProcessManager({
    async verifyProcesses(records) {
      bulkCalls += 1;
      await new Promise((resolve) => {
        releaseVerification = resolve;
      });
      return Object.fromEntries(records.map((record) => [record.profileId, 'verified']));
    },
  });
  await manager.restore([]);
  manager.processes.set('profile-1', {
    ...persistedRecord,
    child: null,
    verificationPromise: null,
  });

  const first = manager.getStatuses(['profile-1'], { force: true });
  const second = manager.getStatuses(['profile-1'], { force: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bulkCalls, 1);
  releaseVerification();
  assert.deepEqual(await first, { 'profile-1': { running: true } });
  assert.deepEqual(await second, { 'profile-1': { running: true } });
});

test('reverifies a recovered PID after an in-flight status check before closing', async () => {
  let releaseBulkVerification;
  const signals = [];
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return 'mismatch';
    },
    async verifyProcesses(records) {
      await new Promise((resolve) => {
        releaseBulkVerification = resolve;
      });
      return Object.fromEntries(records.map((record) => [record.profileId, 'verified']));
    },
    terminateProcess(pid, signal) {
      signals.push({ pid, signal });
      return true;
    },
  });
  manager.processes.set('profile-1', {
    ...persistedRecord,
    child: null,
    verificationPromise: null,
  });

  const statusRequest = manager.getStatuses(['profile-1'], { force: true });
  await new Promise((resolve) => setImmediate(resolve));
  const closeRequest = manager.close('profile-1');
  releaseBulkVerification();

  assert.deepEqual(await statusRequest, { 'profile-1': { running: true } });
  assert.deepEqual(await closeRequest, { success: false, error: 'Browser not running' });
  assert.deepEqual(signals, []);
});

test('serializes concurrent close requests for the same recovered process', async () => {
  let active = true;
  let signalCount = 0;
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      return active ? 'verified' : 'mismatch';
    },
    terminateProcess() {
      signalCount += 1;
      active = false;
      return true;
    },
  });
  await manager.restore([persistedRecord]);

  const first = manager.close('profile-1');
  const second = manager.close('profile-1');

  assert.equal(first, second);
  assert.deepEqual(await first, { success: true });
  assert.equal(signalCount, 1);
});

test('restores multiple recovered processes from one verifier snapshot', async () => {
  let singleCalls = 0;
  let bulkCalls = 0;
  const manager = new processModule.BrowserProcessManager({
    async verifyProcess() {
      singleCalls += 1;
      return 'verified';
    },
    async verifyProcesses(records) {
      bulkCalls += 1;
      return {
        [records[0].profileId]: 'verified',
        [records[1].profileId]: 'mismatch',
      };
    },
  });

  assert.deepEqual(await manager.restore([
    persistedRecord,
    { ...persistedRecord, profileId: 'stale', pid: 2002 },
  ]), ['profile-1']);
  assert.equal(bulkCalls, 1);
  assert.equal(singleCalls, 0);
});
