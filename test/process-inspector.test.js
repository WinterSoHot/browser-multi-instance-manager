const test = require('node:test');
const assert = require('node:assert/strict');

let processInspector = {};
try {
  processInspector = require('../lib/process-inspector');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

const chromeRecord = {
  profileId: 'work',
  browserType: 'chrome',
  profilePath: '/Users/test/profiles/chrome/work',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  pid: 4321,
};

test('matches a process only when its browser and profile arguments both match', () => {
  const details = (commandLine, executablePath = chromeRecord.executablePath) => ({
    executablePath,
    commandLine,
  });
  assert.equal(
    processInspector.matchesBrowserProcessCommand?.(
      chromeRecord,
      details('/Applications/Google Chrome --user-data-dir=/Users/test/profiles/chrome/work'),
      'darwin',
    ),
    true,
  );
  assert.equal(
    processInspector.matchesBrowserProcessCommand?.(
      chromeRecord,
      details('/Applications/Google Chrome --user-data-dir=/Users/test/profiles/chrome/personal'),
      'darwin',
    ),
    false,
  );
  assert.equal(
    processInspector.matchesBrowserProcessCommand?.(
      chromeRecord,
      details(
        '/Applications/Google Chrome Helper --user-data-dir=/Users/test/profiles/chrome/work',
        '/Applications/Google Chrome Helper',
      ),
      'darwin',
    ),
    false,
  );
  assert.equal(
    processInspector.matchesBrowserProcessCommand?.(
      chromeRecord,
      details('/Applications/Google Chrome --user-data-dir=/Users/test/profiles/chrome/work-evil'),
      'darwin',
    ),
    false,
  );
  for (const commandLine of [
    '/Applications/Google Chrome --foo="--user-data-dir=/Users/test/profiles/chrome/work"',
    '/Applications/Google Chrome x"--user-data-dir=/Users/test/profiles/chrome/work"',
  ]) {
    assert.equal(
      processInspector.matchesBrowserProcessCommand?.(
        chromeRecord,
        details(commandLine),
        'darwin',
      ),
      false,
    );
  }
});

test('matches Firefox-style profile arguments', () => {
  const record = {
    ...chromeRecord,
    browserType: 'firefox',
    executablePath: '/Applications/Firefox.app/Contents/MacOS/firefox',
  };
  assert.equal(
    processInspector.matchesBrowserProcessCommand?.(
      record,
      {
        executablePath: record.executablePath,
        commandLine: '/Applications/Firefox.app/Contents/MacOS/firefox -no-remote -profile /Users/test/profiles/chrome/work',
      },
      'darwin',
    ),
    true,
  );
  assert.equal(
    processInspector.matchesBrowserProcessCommand?.(
      record,
      {
        executablePath: record.executablePath,
        commandLine: '/Applications/Firefox.app/Contents/MacOS/firefox -profile-other /tmp /Users/test/profiles/chrome/work',
      },
      'darwin',
    ),
    false,
  );
  assert.equal(
    processInspector.matchesBrowserProcessCommand?.(
      record,
      {
        executablePath: record.executablePath,
        commandLine: '/Applications/Firefox -foo="-profile /Users/test/profiles/chrome/work"',
      },
      'darwin',
    ),
    false,
  );
});

test('reads macOS process details without invoking a shell', async () => {
  const calls = [];
  const details = await processInspector.getProcessDetails?.(4321, {
    platform: 'darwin',
    execFileProcess(executable, args, callback) {
      calls.push({ executable, args });
      const output = executable === 'lsof'
        ? 'p4321\nftxt\nn/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n'
        : 'Google Chrome --user-data-dir=/profiles/work\n';
      callback(null, output, '');
    },
  });

  assert.deepEqual(details, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    commandLine: 'Google Chrome --user-data-dir=/profiles/work',
  });
  assert.deepEqual(calls, [
    { executable: 'lsof', args: ['-a', '-p', '4321', '-d', 'txt', '-Fn'] },
    { executable: 'ps', args: ['-ww', '-p', '4321', '-o', 'command='] },
  ]);
});

test('reads Windows process details with a numeric PID and no shell', async () => {
  const calls = [];
  const details = await processInspector.getProcessDetails?.(4321, {
    platform: 'win32',
    execFileProcess(executable, args, callback) {
      calls.push({ executable, args });
      callback(null, JSON.stringify({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\chrome.exe',
        commandLine: '"C:\\Program Files\\Google\\Chrome\\chrome.exe" --user-data-dir=C:\\profiles\\work',
      }));
    },
  });

  assert.match(details.commandLine, /chrome\.exe/);
  assert.equal(calls[0].executable, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 3), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
  ]);
  assert.match(calls[0].args[3], /ProcessId = 4321/);
  assert.doesNotMatch(calls[0].args[3], /;\s*\|/u);
  assert.match(calls[0].args[3], /ConvertTo-Json -Compress -InputObject/u);
});

test('matches Windows browser paths without case sensitivity', () => {
  const record = {
    profileId: 'work',
    browserType: 'chrome',
    profilePath: 'C:\\Profiles\\Work',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\chrome.exe',
    pid: 123,
  };

  assert.equal(
    processInspector.matchesBrowserProcessCommand?.(
      record,
      {
        executablePath: 'c:\\program files\\google\\chrome\\CHROME.EXE',
        commandLine: '"c:\\program files\\google\\chrome\\CHROME.EXE" --user-data-dir=c:\\profiles\\work',
      },
      'win32',
    ),
    true,
  );
});

test('rejects invalid persisted PIDs before executing a system command', async () => {
  let executed = false;
  const details = await processInspector.getProcessDetails?.('4321; open -a Calculator', {
    platform: 'darwin',
    execFileProcess() {
      executed = true;
    },
  });

  assert.equal(details, null);
  assert.equal(executed, false);
});

test('distinguishes a missing process from an unavailable inspection', async () => {
  assert.equal(
    await processInspector.inspectBrowserProcess?.(chromeRecord, {
      getDetails: async () => null,
      isPidAlive: () => false,
    }),
    'mismatch',
  );
  assert.equal(
    await processInspector.inspectBrowserProcess?.(chromeRecord, {
      getDetails: async () => null,
      isPidAlive: () => true,
    }),
    'unavailable',
  );
  assert.equal(
    await processInspector.inspectBrowserProcess?.(chromeRecord, {
      platform: 'darwin',
      getDetails: async () => ({
        executablePath: chromeRecord.executablePath,
        commandLine: '/Applications/Google Chrome --user-data-dir=/Users/test/profiles/chrome/work',
      }),
      isPidAlive: () => true,
    }),
    'verified',
  );
});

test('verifies multiple recovered processes from one shared detail snapshot', async () => {
  let snapshotCalls = 0;
  const records = [
    {
      profileId: 'work',
      browserType: 'chrome',
      profilePath: '/profiles/work',
      executablePath: '/Applications/Chrome',
      pid: 100,
    },
    {
      profileId: 'personal',
      browserType: 'firefox',
      profilePath: '/profiles/personal',
      executablePath: '/Applications/Firefox',
      pid: 200,
    },
  ];

  assert.deepEqual(
    await processInspector.inspectBrowserProcesses?.(records, {
      platform: 'darwin',
      async getDetailsBatch() {
        snapshotCalls += 1;
        return new Map([
          [100, {
            executablePath: '/Applications/Chrome',
            commandLine: '/Applications/Chrome --user-data-dir=/profiles/work',
          }],
          [200, {
            executablePath: '/Applications/Firefox',
            commandLine: '/Applications/Firefox -profile /wrong',
          }],
        ]);
      },
    }),
    { work: 'verified', personal: 'mismatch' },
  );
  assert.equal(snapshotCalls, 1);
});

test('chunks large process snapshots before invoking platform inspection', async () => {
  const batchSizes = [];
  const records = Array.from({ length: 5 }, (_, index) => ({
    ...chromeRecord,
    profileId: `profile-${index}`,
    pid: 5000 + index,
  }));

  const result = await processInspector.inspectBrowserProcesses?.(records, {
    platform: 'darwin',
    batchSize: 2,
    async getDetailsBatch(batch) {
      batchSizes.push(batch.length);
      return new Map(batch.map((record) => [record.pid, {
        executablePath: record.executablePath,
        commandLine: `${record.executablePath} --user-data-dir=${record.profilePath}`,
      }]));
    },
  });

  assert.deepEqual(batchSizes, [2, 2, 1]);
  assert.deepEqual(Object.values(result), Array(5).fill('verified'));
});

test('limits concurrent platform inspection chunks', async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const releases = [];
  const records = Array.from({ length: 5 }, (_, index) => ({
    ...chromeRecord,
    profileId: `bounded-${index}`,
    pid: 6000 + index,
  }));

  const inspection = processInspector.inspectBrowserProcesses?.(records, {
    platform: 'darwin',
    batchSize: 1,
    batchConcurrency: 2,
    async getDetailsBatch(batch) {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      const record = batch[0];
      return new Map([[record.pid, {
        executablePath: record.executablePath,
        commandLine: `${record.executablePath} --user-data-dir=${record.profilePath}`,
      }]]);
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  while (releases.length > 0 || calls < records.length) {
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(Object.values(await inspection), Array(5).fill('verified'));
  assert.equal(calls, 5);
});
