const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createDiagnosticsService } = require('../lib/diagnostics-service');

const profilesDir = path.resolve(path.sep, 'app-data', 'profiles');
const executablePath = path.resolve(path.sep, 'Applications', 'Google Chrome');
const profilePath = (name = 'Work') => path.join(profilesDir, 'chrome', name);

function createFixture(options = {}) {
  const {
    profile = {
    id: 'profile-1',
    browserType: 'chrome',
    name: 'Work',
    path: profilePath(),
  },
    browserExists = true,
    directoryExists = true,
    createResult = profilePath(),
  } = options;
  const processStatus = Object.prototype.hasOwnProperty.call(options, 'processStatus')
    ? options.processStatus
    : { running: false };
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
    getBrowserExecutable: () => executablePath,
    getProfilesDir: () => profilesDir,
    async pathExists(targetPath) {
      calls.pathExists.push(targetPath);
      if (targetPath === executablePath) return browserExists;
      return directoryExists;
    },
    async createProfileDir(browserType, profileName) {
      calls.createDirectory.push({ browserType, profileName });
      return createResult;
    },
    async createEmptyProfileDir(browserType, profileName) {
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

test('only a valid explicit stopped status can expose a directory repair action', async () => {
  for (const processStatus of [null, undefined, {}, { running: 0 }, { running: 'false' }, {
    running: false,
    verificationUnavailable: true,
  }, { running: false, verificationUnavailable: 'false' }]) {
    const { service, calls } = createFixture({ processStatus, directoryExists: false });
    assert.deepEqual(await service.inspect('profile-1'), {
      code: 'PROCESS_STATE_UNKNOWN',
      state: 'process-unknown',
      actions: ['retry'],
    });
    assert.deepEqual(await service.repairMissingDirectory('profile-1'), {
      success: false,
      code: 'PROCESS_STATE_UNKNOWN',
    });
    assert.deepEqual(calls.createDirectory, []);
  }
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

test('direct repair revalidates the browser executable after confirming stopped', async () => {
  for (const getBrowserExecutable of [() => '', () => executablePath]) {
    const { appStore, calls } = createFixture({ browserExists: false, directoryExists: false });
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
          return { running: false };
        },
      },
      getBrowserExecutable,
      getProfilesDir: () => profilesDir,
      async pathExists(targetPath) {
        calls.pathExists.push(targetPath);
        return false;
      },
      createEmptyProfileDir: async () => {
        assert.fail('invalid browser path must block directory creation');
      },
    });

    assert.deepEqual(await service.repairMissingDirectory('profile-1'), {
      success: false,
      code: 'BROWSER_PATH_INVALID',
    });
    assert.deepEqual(calls.getStatus, [{
      profileId: 'profile-1',
      options: { force: true },
    }]);
    assert.deepEqual(calls.pathExists, getBrowserExecutable() ? [executablePath] : []);
  }
});

test('repair refuses a profile whose stored path is outside the controlled profile directory', async () => {
  const { service, calls } = createFixture({
    profile: {
      id: 'profile-1',
      browserType: 'chrome',
      name: 'Work',
      path: path.resolve(path.sep, 'private', 'untrusted'),
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
      path: profilePath('Work.'),
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

test('inspection rejects a normalized-but-not-exact stored path representation without checking it', async () => {
  const { service, calls } = createFixture({
    profile: {
      id: 'profile-1',
      browserType: 'chrome',
      name: 'Work',
      path: `${path.join(profilesDir, 'chrome')}${path.sep}..${path.sep}chrome${path.sep}Work`,
    },
    directoryExists: false,
  });

  assert.deepEqual(await service.inspect('profile-1'), {
    code: 'PROFILE_PATH_INVALID',
    state: 'profile-directory-missing',
    actions: ['retry'],
  });
  assert.deepEqual(calls.pathExists, [executablePath]);
  assert.deepEqual(calls.createDirectory, []);
});

test('repair rejects a normalized-but-not-exact stored path representation', async () => {
  const { service, calls } = createFixture({
    profile: {
      id: 'profile-1',
      browserType: 'chrome',
      name: 'Work',
      path: `${path.join(profilesDir, 'chrome')}${path.sep}..${path.sep}chrome${path.sep}Work`,
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
    executablePath,
    profilePath(),
  ]);
  assert.deepEqual(calls.createDirectory, [{ browserType: 'chrome', profileName: 'Work' }]);

  const mismatch = createFixture({
    directoryExists: false,
    createResult: path.resolve(path.sep, 'wrong', 'path'),
  });
  assert.deepEqual(await mismatch.service.repairMissingDirectory('profile-1'), {
    success: false,
    code: 'CREATE_PATH_MISMATCH',
  });
  assert.deepEqual(mismatch.calls.createDirectory, [{ browserType: 'chrome', profileName: 'Work' }]);
});

test('repair reports a stable failure when the directory appears after the pre-check', async () => {
  const { appStore, calls } = createFixture({ directoryExists: false });
  const service = createDiagnosticsService({
    appStore,
    profileOperations: { runMutation: (_profileId, operation) => operation() },
    browserProcessManager: { getStatus: async () => ({ running: false }) },
    getBrowserExecutable: () => executablePath,
    getProfilesDir: () => profilesDir,
    pathExists: async (targetPath) => targetPath === executablePath,
    createEmptyProfileDir: async () => {
      calls.createDirectory.push({ browserType: 'chrome', profileName: 'Work' });
      const error = new Error('already exists');
      error.code = 'EEXIST';
      throw error;
    },
  });

  assert.deepEqual(await service.repairMissingDirectory('profile-1'), {
    success: false,
    code: 'DIRECTORY_PRESENT',
  });
  assert.deepEqual(calls.createDirectory, [{ browserType: 'chrome', profileName: 'Work' }]);
});

test('repair returns stable failures without raw filesystem errors', async () => {
  const { service } = createFixture({ directoryExists: false });
  const result = await createDiagnosticsService({
    appStore: { getProfiles: () => [{
      id: 'profile-1', browserType: 'chrome', name: 'Work', path: profilePath(),
    }] },
    profileOperations: { runMutation: (_profileId, operation) => operation() },
    browserProcessManager: { getStatus: async () => ({ running: false }) },
    getBrowserExecutable: () => executablePath,
    getProfilesDir: () => profilesDir,
    pathExists: async (targetPath) => targetPath === executablePath,
    createEmptyProfileDir: async () => {
      throw new Error(`${path.resolve(path.sep, 'private', 'secret')} permission denied`);
    },
  }).repairMissingDirectory('profile-1');

  assert.deepEqual(result, { success: false, code: 'DIRECTORY_CREATE_FAILED' });
  assert.equal(JSON.stringify(result).includes(path.resolve(path.sep, 'private', 'secret')), false);
  assert.ok(service);
});

test('service outer boundaries convert store, directory, and coordinator failures into stable results', async () => {
  const unavailable = {
    code: 'DIAGNOSTICS_UNAVAILABLE',
    state: 'process-unknown',
    actions: ['retry'],
  };
  const inspectService = createDiagnosticsService({
    appStore: { getProfiles: () => { throw path.resolve(path.sep, 'private', 'store'); } },
  });
  assert.deepEqual(await inspectService.inspect('profile-1'), unavailable);
  assert.deepEqual(await createDiagnosticsService({
    appStore: { getProfiles: () => { throw new Error('store unavailable'); } },
    profileOperations: { runMutation: (_profileId, operation) => operation() },
  }).repairMissingDirectory('profile-1'), {
    success: false,
    code: 'DIAGNOSTICS_UNAVAILABLE',
  });

  const directoryService = createDiagnosticsService({
    appStore: { getProfiles: () => [{
      id: 'profile-1', browserType: 'chrome', name: 'Work', path: profilePath(),
    }] },
    browserProcessManager: { getStatus: async () => ({ running: false }) },
    getBrowserExecutable: () => executablePath,
    getProfilesDir: () => { throw new Error('secret directory'); },
    pathExists: async () => true,
    profileOperations: {
      runMutation: () => Promise.reject({ raw: path.resolve(path.sep, 'private', 'queue') }),
    },
  });
  assert.deepEqual(await directoryService.inspect('profile-1'), unavailable);
  assert.deepEqual(await directoryService.repairMissingDirectory('profile-1'), {
    success: false,
    code: 'DIAGNOSTICS_UNAVAILABLE',
  });
  assert.deepEqual(await createDiagnosticsService({
    profileOperations: { runMutation: () => { throw 'queue unavailable'; } },
  }).repairMissingDirectory('profile-1'), {
    success: false,
    code: 'DIAGNOSTICS_UNAVAILABLE',
  });
});
