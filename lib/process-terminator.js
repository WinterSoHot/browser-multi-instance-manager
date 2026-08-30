const { execFile } = require('node:child_process');

function isValidPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

function isProcessGroupAlive(pid, killProcess = process.kill) {
  try {
    killProcess(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function runTaskkill(pid, execFileProcess, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      try {
        child?.kill();
      } catch {
        // A failed taskkill is reported as false below.
      }
      finish(false);
    }, timeoutMs);
    timeout.unref?.();

    try {
      child = execFileProcess(
        'taskkill.exe',
        ['/pid', String(pid), '/t'],
        (error) => finish(!error),
      );
    } catch {
      finish(false);
    }
  });
}

async function terminateLaunchedProcessTree(
  record,
  {
    platform = process.platform,
    killProcess = process.kill,
    execFileProcess = execFile,
    timeoutMs = 5000,
    pollIntervalMs = 100,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    isProcessGroupAlive: checkProcessGroup = (pid) => isProcessGroupAlive(pid, killProcess),
  } = {},
) {
  if (!isValidPid(record?.pid)) return false;

  if (platform === 'darwin') {
    try {
      killProcess(-record.pid, 'SIGTERM');
    } catch (error) {
      return error?.code === 'ESRCH';
    }

    const deadline = Date.now() + timeoutMs;
    while (checkProcessGroup(record.pid)) {
      if (Date.now() >= deadline) return false;
      await wait(pollIntervalMs);
    }
    return true;
  }

  if (platform === 'win32') {
    return runTaskkill(record.pid, execFileProcess, timeoutMs);
  }

  try {
    return record.child?.kill('SIGTERM') !== false;
  } catch {
    return false;
  }
}

module.exports = { terminateLaunchedProcessTree };
