const test = require('node:test');
const assert = require('node:assert/strict');

let terminator = {};
try {
  terminator = require('../lib/process-terminator');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('signals the detached process group for an app-launched macOS browser', async () => {
  const signals = [];
  assert.equal(await terminator.terminateLaunchedProcessTree?.({ pid: 4321 }, {
    platform: 'darwin',
    killProcess(pid, signal) {
      signals.push({ pid, signal });
    },
    isProcessGroupAlive: () => false,
  }), true);
  assert.deepEqual(signals, [{ pid: -4321, signal: 'SIGTERM' }]);
});

test('waits for a macOS process group to drain after signaling it', async () => {
  let checks = 0;
  const waits = [];
  assert.equal(await terminator.terminateLaunchedProcessTree?.({ pid: 4321 }, {
    platform: 'darwin',
    killProcess() {},
    isProcessGroupAlive() {
      checks += 1;
      return checks < 3;
    },
    wait: async (milliseconds) => waits.push(milliseconds),
    pollIntervalMs: 25,
  }), true);
  assert.equal(checks, 3);
  assert.deepEqual(waits, [25, 25]);
});

test('treats an already-absent macOS process group as terminated', async () => {
  const missing = new Error('No such process');
  missing.code = 'ESRCH';
  assert.equal(await terminator.terminateLaunchedProcessTree?.({ pid: 4321 }, {
    platform: 'darwin',
    killProcess() {
      throw missing;
    },
  }), true);
});

test('uses taskkill tree mode for an app-launched Windows browser', async () => {
  const calls = [];
  assert.equal(await terminator.terminateLaunchedProcessTree?.({ pid: 4321 }, {
    platform: 'win32',
    execFileProcess(executable, args, callback) {
      calls.push({ executable, args });
      callback(null, '', '');
    },
  }), true);
  assert.deepEqual(calls, [{
    executable: 'taskkill.exe',
    args: ['/pid', '4321', '/t'],
  }]);
});

test('refuses invalid PIDs without invoking a platform command', async () => {
  let called = false;
  assert.equal(await terminator.terminateLaunchedProcessTree?.({ pid: '4 & calc' }, {
    platform: 'win32',
    execFileProcess() {
      called = true;
    },
  }), false);
  assert.equal(called, false);
});
