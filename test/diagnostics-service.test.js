const test = require('node:test');
const assert = require('node:assert/strict');

const { createDiagnosticsService } = require('../lib/diagnostics-service');

function createFixture({
  profile = {
    id: 'profile-1',
    browserType: 'chrome',
    name: 'Work',
    path: '/app-data/profiles/chrome/Work',
  },
  processStatus = { running: false },
  browserExists = true,
  directoryExists = true,
  createResult = '/app-data/profiles/chrome/Work',
} = {}) {
  const calls = {
    createDirectory: [],
    getStatus: [],
    pathExists: [],
    mutations: [],
  };
  const appStore = {
    profiles: profile ? [profile] : [],
    getProfiles() {
      return this.profiles.map((item) => ({ ...item }));
    },
  };
  const service = createDiagnosticsService({
    appStore,
    profileOperations: {
      runMutation(profileId, operation) {
        calls.mutations.push(profileId);
        return operation();
      },
    },
    browserProcessManager: {
      async getStatus(profileId, options) {
        calls.getStatus.push({ profileId, options });
        return processStatus;
      },
    },
    getBrowserExecutable: () => '/Applications/Google Chrome',
    getProfilesDir: () => '/app-data/profiles',
    async pathExists(targetPath) {
      calls.pathExists.push(targetPath);
      if (targetPath === '/Applications/Google Chrome') return browserExists;
      return directoryExists;
    },
    async createProfileDir(browserType, profileName) {
      calls.createDirectory.push({ browserType, profileName });
      return createResult;
    },
  });
  return { service, calls, appStore };
}

test('inspection prioritizes unknown process state over invalid browser and missing directory', async () => {
  const { service } = createFixture({
    processStatus: { running: true, verificationUnavailable: true },
    browserExists: false,
    directoryExists: false,
  });

  assert.deepEqual(await service.inspect('profile-1'), {
    code: 'PROCESS_STATE_UNKNOWN',
    state: 'process-unknown',
    actions: ['retry'],
  });
});

test('inspection offers only listed safe actions for invalid browser, stopped missing directory, and running missing directory', async () => {
  const browserInvalid = createFixture({ browserExists: false, directoryExists: false });
  assert.deepEqual(await browserInvalid.service.inspect('profile-1'), {
    code: 'BROWSER_PATH_INVALID',
    state: 'browser-path-invalid',
    actions: ['retry', 'open-settings'],
  });

  const stoppedMissing = createFixture({ directoryExists: false });
  assert.deepEqual(await stoppedMissing.service.inspect('profile-1'), {
    code: 'PROFILE_DIRECTORY_MISSING',
    state: 'profile-directory-missing',
    actions: ['retry', 'recreate-empty-directory'],
  });

  const runningMissing = createFixture({ processStatus: { running: true }, directoryExists: false });
  assert.deepEqual(await runningMissing.service.inspect('profile-1'), {
    code: 'PROFILE_DIRECTORY_MISSING',
    state: 'profile-directory-missing',
    actions: ['retry'],
  });
});

test('healthy inspection has no repair actions', async () => {
  const { service } = createFixture();

  assert.deepEqual(await service.inspect('profile-1'), {
    code: 'HEALTHY',
    state: 'healthy',
    actions: [],
  });
});

test('unknown or running process state forbids directory repair after a forced fresh status check', async () => {
  for (const [processStatus, code] of [
    [{ running: true, verificationUnavailable: true }, 'PROCESS_STATE_UNKNOWN'],
    [{ running: true }, 'PROFILE_RUNNING'],
  ]) {
    const { service, calls } = createFixture({ processStatus, directoryExists: false });
    assert.deepEqual(await service.repairMissingDirectory('profile-1'), { success: false, code });
    assert.deepEqual(calls.getStatus, [{ profileId: 'profile-1', options: { force: true } }]);
    assert.deepEqual(calls.createDirectory, []);
    assert.deepEqual(calls.mutations, ['profile-1']);
  }
});

test('repair refuses a profile whose stored path is outside the controlled profile directory', async () => {
  const { service, calls } = createFixture({
    profile: {
      id: 'profile-1',
      browserType: 'chrome',
      name: 'Work',
      path: '/private/untrusted',
    },
    directoryExists: false,
  });

  assert.deepEqual(await service.repairMissingDirectory('profile-1'), {
    success: false,
    code: 'PROFILE_PATH_INVALID',
  });
  assert.deepEqual(calls.getStatus, []);
  assert.deepEqual(calls.createDirectory, []);
});

test('repair converts an invalid stored profile name into a stable path code', async () => {
  const { service, calls } = createFixture({
    profile: {
      id: 'profile-1',
      browserType: 'chrome',
      name: 'Work.',
      path: '/app-data/profiles/chrome/Work.',
    },
    directoryExists: false,
  });

  assert.deepEqual(await service.repairMissingDirectory('profile-1'), {
    success: false,
    code: 'PROFILE_PATH_INVALID',
  });
  assert.deepEqual(calls.getStatus, []);
  assert.deepEqual(calls.createDirectory, []);
});

test('repair re-reads the profile, checks the missing directory again, and accepts only the exact expected create result', async () => {
  const { service, calls } = createFixture({ directoryExists: false });

  assert.deepEqual(await service.repairMissingDirectory('profile-1'), {
    success: true,
    code: 'DIRECTORY_RECREATED',
  });
  assert.deepEqual(calls.pathExists, [
    '/app-data/profiles/chrome/Work',
    '/app-data/profiles/chrome/Work',
  ]);
  assert.deepEqual(calls.createDirectory, [{ browserType: 'chrome', profileName: 'Work' }]);

  const mismatch = createFixture({ directoryExists: false, createResult: '/wrong/path' });
  assert.deepEqual(await mismatch.service.repairMissingDirectory('profile-1'), {
    success: false,
    code: 'CREATE_PATH_MISMATCH',
  });
  assert.deepEqual(mismatch.calls.createDirectory, [{ browserType: 'chrome', profileName: 'Work' }]);
});

test('repair returns stable failures without raw filesystem errors', async () => {
  const { service } = createFixture({ directoryExists: false });
  const result = await createDiagnosticsService({
    appStore: { getProfiles: () => [{
      id: 'profile-1', browserType: 'chrome', name: 'Work', path: '/app-data/profiles/chrome/Work',
    }] },
    profileOperations: { runMutation: (_profileId, operation) => operation() },
    browserProcessManager: { getStatus: async () => ({ running: false }) },
    getBrowserExecutable: () => '/Applications/Google Chrome',
    getProfilesDir: () => '/app-data/profiles',
    pathExists: async () => false,
    createProfileDir: async () => { throw new Error('/private/secret permission denied'); },
  }).repairMissingDirectory('profile-1');

  assert.deepEqual(result, { success: false, code: 'DIRECTORY_CREATE_FAILED' });
  assert.equal(JSON.stringify(result).includes('/private/secret'), false);
  assert.ok(service);
});
