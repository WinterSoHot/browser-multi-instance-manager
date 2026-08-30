const path = require('node:path');
const { execFile } = require('node:child_process');

const DEFAULT_INSPECTION_TIMEOUT_MS = 5000;

function isValidPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

async function runWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
}

function execFileText(executable, args, execFileProcess, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      try {
        child?.kill();
      } catch {
        // The inspection result is already treated as unavailable.
      }
      finish(null);
    }, timeoutMs);
    timeout.unref?.();

    try {
      child = execFileProcess(executable, args, (error, stdout) => {
        if (error || typeof stdout !== 'string' || stdout.trim() === '') {
          finish(null);
          return;
        }
        finish(stdout.trim());
      });
    } catch {
      finish(null);
    }
  });
}

async function getProcessDetails(
  pid,
  {
    platform = process.platform,
    execFileProcess = execFile,
    timeoutMs = DEFAULT_INSPECTION_TIMEOUT_MS,
  } = {},
) {
  if (!isValidPid(pid)) {
    return null;
  }

  if (platform === 'darwin') {
    const [openTextFiles, commandLine] = await Promise.all([
      execFileText(
        'lsof',
        ['-a', '-p', String(pid), '-d', 'txt', '-Fn'],
        execFileProcess,
        timeoutMs,
      ),
      execFileText(
        'ps',
        ['-ww', '-p', String(pid), '-o', 'command='],
        execFileProcess,
        timeoutMs,
      ),
    ]);
    const executablePath = openTextFiles
      ?.split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
    return executablePath && commandLine ? { executablePath, commandLine } : null;
  }

  if (platform === 'win32') {
    const script = `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; `
      + 'if ($null -ne $process) { '
      + 'ConvertTo-Json -Compress -InputObject '
      + '([PSCustomObject]@{ executablePath = $process.ExecutablePath; '
      + 'commandLine = $process.CommandLine }) }';
    const output = await execFileText(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      execFileProcess,
      timeoutMs,
    );
    if (!output) return null;
    try {
      const details = JSON.parse(output);
      return typeof details.executablePath === 'string'
        && typeof details.commandLine === 'string'
        ? details
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

function parseMacProcessDetails(openFilesOutput, commandOutput) {
  const executables = new Map();
  let currentPid = null;
  for (const line of (openFilesOutput || '').split('\n')) {
    if (line.startsWith('p')) currentPid = Number(line.slice(1));
    else if (currentPid && line.startsWith('n') && !executables.has(currentPid)) {
      executables.set(currentPid, line.slice(1));
    }
  }
  const commands = new Map();
  for (const line of (commandOutput || '').split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/u);
    if (match) commands.set(Number(match[1]), match[2]);
  }
  return new Map([...commands].flatMap(([pid, commandLine]) => (
    executables.has(pid)
      ? [[pid, { executablePath: executables.get(pid), commandLine }]]
      : []
  )));
}

async function getProcessDetailsBatch(
  records,
  {
    platform = process.platform,
    execFileProcess = execFile,
    timeoutMs = DEFAULT_INSPECTION_TIMEOUT_MS,
  } = {},
) {
  const pids = [...new Set(records.map((record) => record?.pid).filter(isValidPid))];
  if (pids.length === 0) return new Map();

  if (platform === 'darwin') {
    const pidList = pids.join(',');
    const [openFilesOutput, commandOutput] = await Promise.all([
      execFileText('lsof', ['-a', '-p', pidList, '-d', 'txt', '-Fpn'], execFileProcess, timeoutMs),
      execFileText('ps', ['-ww', '-p', pidList, '-o', 'pid=,command='], execFileProcess, timeoutMs),
    ]);
    if (!openFilesOutput || !commandOutput) return new Map();
    return parseMacProcessDetails(openFilesOutput, commandOutput);
  }

  if (platform === 'win32') {
    const filter = pids.map((pid) => `ProcessId = ${pid}`).join(' OR ');
    const script = `$processes = Get-CimInstance Win32_Process -Filter "${filter}"; `
      + '$processes | ForEach-Object { [PSCustomObject]@{ pid = $_.ProcessId; '
      + 'executablePath = $_.ExecutablePath; commandLine = $_.CommandLine } } | ConvertTo-Json -Compress';
    const output = await execFileText(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      execFileProcess,
      timeoutMs,
    );
    if (!output) return new Map();
    try {
      const rows = JSON.parse(output);
      return new Map((Array.isArray(rows) ? rows : [rows]).flatMap((row) => (
        isValidPid(row?.pid)
        && typeof row.executablePath === 'string'
        && typeof row.commandLine === 'string'
          ? [[row.pid, { executablePath: row.executablePath, commandLine: row.commandLine }]]
          : []
      )));
    } catch {
      return new Map();
    }
  }

  return new Map();
}

function isWhitespace(character) {
  return /\s/u.test(character || '');
}

function getOptionBoundary(commandLine, optionIndex) {
  const before = commandLine[optionIndex - 1];
  if (before === undefined || isWhitespace(before)) {
    return { valid: true, quoted: false };
  }
  if (
    before === '"'
    && (optionIndex === 1 || isWhitespace(commandLine[optionIndex - 2]))
  ) {
    return { valid: true, quoted: true };
  }
  return { valid: false, quoted: false };
}

function hasExactOptionValue(commandLine, option, expectedValue, separator) {
  let searchFrom = 0;
  while (searchFrom < commandLine.length) {
    const optionIndex = commandLine.indexOf(option, searchFrom);
    if (optionIndex === -1) return false;
    const optionBoundary = getOptionBoundary(commandLine, optionIndex);
    let valueIndex = optionIndex + option.length;

    if (!optionBoundary.valid) {
      searchFrom = valueIndex;
      continue;
    }
    if (separator === '=') {
      if (commandLine[valueIndex] !== '=') {
        searchFrom = valueIndex;
        continue;
      }
      valueIndex += 1;
    } else {
      if (!isWhitespace(commandLine[valueIndex])) {
        searchFrom = valueIndex;
        continue;
      }
      while (isWhitespace(commandLine[valueIndex])) valueIndex += 1;
    }

    const quoted = commandLine[valueIndex] === '"';
    if (quoted) valueIndex += 1;
    if (!commandLine.startsWith(expectedValue, valueIndex)) {
      searchFrom = valueIndex;
      continue;
    }

    const endIndex = valueIndex + expectedValue.length;
    if (quoted) {
      if (
        commandLine[endIndex] === '"'
        && (commandLine[endIndex + 1] === undefined || isWhitespace(commandLine[endIndex + 1]))
      ) {
        return true;
      }
    } else if (
      commandLine[endIndex] === undefined
      || isWhitespace(commandLine[endIndex])
      || (optionBoundary.quoted && commandLine[endIndex] === '"')
    ) {
      return true;
    }
    searchFrom = endIndex;
  }
  return false;
}

function matchesBrowserProcessCommand(record, details, platform = process.platform) {
  if (
    !record
    || !details
    || !isValidPid(record.pid)
    || typeof record.profilePath !== 'string'
    || typeof record.executablePath !== 'string'
    || typeof details.executablePath !== 'string'
    || typeof details.commandLine !== 'string'
  ) {
    return false;
  }

  const pathApi = platform === 'win32' ? path.win32 : path;
  if (!pathApi.isAbsolute(record.profilePath) || !pathApi.isAbsolute(record.executablePath)) {
    return false;
  }
  const normalize = platform === 'win32'
    ? (value) => value.toLocaleLowerCase()
    : (value) => value;
  const expectedExecutable = normalize(pathApi.normalize(record.executablePath));
  const actualExecutable = normalize(pathApi.normalize(details.executablePath));
  if (actualExecutable !== expectedExecutable) {
    return false;
  }

  const commandLine = normalize(details.commandLine);
  const profilePath = normalize(record.profilePath);
  if (record.browserType === 'chrome' || record.browserType === 'edge') {
    return hasExactOptionValue(commandLine, '--user-data-dir', profilePath, '=');
  }
  if (record.browserType === 'firefox' || record.browserType === 'zen') {
    return hasExactOptionValue(commandLine, '-profile', profilePath, ' ');
  }
  return false;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'ESRCH' ? false : null;
  }
}

async function inspectBrowserProcess(
  record,
  {
    platform = process.platform,
    getDetails = (pid) => getProcessDetails(pid, { platform }),
    isPidAlive: checkPidAlive = isPidAlive,
  } = {},
) {
  let details;
  try {
    details = await getDetails(record?.pid);
  } catch {
    return 'unavailable';
  }

  if (details) {
    return matchesBrowserProcessCommand(record, details, platform)
      ? 'verified'
      : 'mismatch';
  }

  try {
    return checkPidAlive(record?.pid) === false ? 'mismatch' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function inspectBrowserProcesses(
  records,
  {
    platform = process.platform,
    getDetailsBatch = (items) => getProcessDetailsBatch(items, { platform }),
    isPidAlive: checkPidAlive = isPidAlive,
    batchSize = 50,
    batchConcurrency = 4,
  } = {},
) {
  const safeBatchSize = Number.isSafeInteger(batchSize) && batchSize > 0 ? batchSize : 50;
  const safeBatchConcurrency = Number.isSafeInteger(batchConcurrency) && batchConcurrency > 0
    ? batchConcurrency
    : 4;
  const detailsByPid = new Map();
  const batches = [];
  for (let index = 0; index < records.length; index += safeBatchSize) {
    batches.push(records.slice(index, index + safeBatchSize));
  }
  await runWithConcurrency(batches, safeBatchConcurrency, async (batch) => {
    try {
      const batchDetails = await getDetailsBatch(batch);
      for (const [pid, details] of batchDetails) detailsByPid.set(pid, details);
    } catch {
      // Missing batch details are classified below using PID liveness.
    }
  });

  return Object.fromEntries(records.map((record) => {
    const details = detailsByPid.get(record?.pid);
    if (details) {
      return [
        record.profileId,
        matchesBrowserProcessCommand(record, details, platform) ? 'verified' : 'mismatch',
      ];
    }
    let alive = null;
    try {
      alive = checkPidAlive(record?.pid);
    } catch {
      // Treat permission and inspection failures as unavailable.
    }
    return [record.profileId, alive === false ? 'mismatch' : 'unavailable'];
  }));
}

module.exports = {
  getProcessDetails,
  getProcessDetailsBatch,
  inspectBrowserProcess,
  inspectBrowserProcesses,
  matchesBrowserProcessCommand,
};
