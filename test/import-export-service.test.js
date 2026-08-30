const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let createImportExportService;
try {
  ({ createImportExportService } = require('../lib/import-export-service'));
} catch {
  // The first TDD run intentionally exercises the missing service.
}

const profilesRoot = path.resolve('test-fixtures', 'profiles');
const profilePath = (browserType, profileName) => (
  path.join(profilesRoot, browserType, profileName)
);

function createFixture({
  profiles = [],
  failCreateAt = null,
  failCreateCode = null,
  createFailureLeavesPath = false,
  existingPaths: additionalExistingPaths = [],
  throwSetProfilesAt = null,
  now = () => 0,
  maxPreviewTokens,
} = {}) {
  let storedProfiles = structuredClone(profiles);
  const existingPaths = new Set([
    ...profiles.map((profile) => profile.path).filter(Boolean),
    ...additionalExistingPaths,
  ]);
  const createdDirectories = [];
  const removedDirectories = [];
  let createCalls = 0;
  let setProfilesCalls = 0;
  const service = createImportExportService({
    appStore: {
      getProfiles: () => structuredClone(storedProfiles),
      setProfiles(nextProfiles) {
        setProfilesCalls += 1;
        if (setProfilesCalls === throwSetProfilesAt) throw new Error('store write unavailable');
        storedProfiles = structuredClone(nextProfiles);
      },
    },
    profileOperations: { runGlobalMutation: (operation) => operation() },
    getProfilePath: profilePath,
    createEmptyProfileDir: async (browserType, profileName) => {
      createCalls += 1;
      const targetPath = profilePath(browserType, profileName);
      if (createCalls === failCreateAt) {
        if (createFailureLeavesPath) existingPaths.add(targetPath);
        const error = new Error('unavailable directory');
        if (failCreateCode) error.code = failCreateCode;
        throw error;
      }
      if (existingPaths.has(targetPath)) {
        const error = new Error('directory already exists');
        error.code = 'EEXIST';
        throw error;
      }
      existingPaths.add(targetPath);
      createdDirectories.push(targetPath);
      return targetPath;
    },
    removeEmptyDirectory: async (targetPath) => {
      removedDirectories.push(targetPath);
      existingPaths.delete(targetPath);
    },
    now,
    maxPreviewTokens,
  });

  return {
    service,
    profiles: () => structuredClone(storedProfiles),
    setProfiles(nextProfiles) {
      storedProfiles = structuredClone(nextProfiles);
    },
    createdDirectories,
    removedDirectories,
    hasDirectory: (targetPath) => existingPaths.has(targetPath),
  };
}

test('preview classifies every row without filesystem or store side effects', async () => {
  const fixture = createFixture({
    profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work', path: profilePath('chrome', 'Work') }],
  });
  const before = fixture.profiles();

  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [
      { browserType: 'firefox', name: 'Personal', path: '/not-imported' },
      { browserType: 'chrome', name: 'work' },
      { browserType: 'chrome', name: '../unsafe' },
    ],
  });

  assert.equal(preview?.code, 'OK');
  assert.equal(preview?.valid.length, 1);
  assert.deepEqual(preview?.duplicates, [{ line: 2, browserType: 'chrome', name: 'work' }]);
  assert.deepEqual(preview?.invalid, [{ line: 3, code: 'INVALID_PROFILE_METADATA' }]);
  assert.match(preview?.token || '', /^[a-f0-9]{64}$/u);
  assert.deepEqual(fixture.createdDirectories, []);
  assert.deepEqual(fixture.profiles(), before);
});

test('execute applies skip and sequential auto-rename decisions without importing metadata fields', async () => {
  const fixture = createFixture({
    profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work', path: profilePath('chrome', 'Work') }],
  });
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [
      { browserType: 'chrome', name: 'Work', workspaceId: 'outside', favorite: true },
      { browserType: 'chrome', name: 'work', id: 'outside-id', createdAt: 'outside-time' },
      { browserType: 'firefox', name: 'Personal', path: '/outside' },
    ],
  });

  const result = await fixture.service?.executeImport({
    token: preview?.token,
    decisions: [
      { line: 1, action: 'rename' },
      { line: 2, action: 'rename' },
    ],
  });

  assert.equal(result?.success, true);
  assert.deepEqual(fixture.profiles().map((profile) => ({
    browserType: profile.browserType,
    name: profile.name,
    workspaceId: profile.workspaceId,
    favorite: profile.favorite,
    lastLaunchedAt: profile.lastLaunchedAt,
  })), [
    { browserType: 'chrome', name: 'Work', workspaceId: undefined, favorite: undefined, lastLaunchedAt: undefined },
    { browserType: 'chrome', name: 'Work 副本', workspaceId: undefined, favorite: undefined, lastLaunchedAt: undefined },
    { browserType: 'chrome', name: 'work 副本 (2)', workspaceId: undefined, favorite: undefined, lastLaunchedAt: undefined },
    { browserType: 'firefox', name: 'Personal', workspaceId: undefined, favorite: undefined, lastLaunchedAt: undefined },
  ]);
  assert.deepEqual(fixture.createdDirectories, [
    profilePath('chrome', 'Work 副本'),
    profilePath('chrome', 'work 副本 (2)'),
    profilePath('firefox', 'Personal'),
  ]);
});

test('execute uses the current profiles snapshot and rejects a preview made stale by a new conflict', async () => {
  const fixture = createFixture();
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [{ browserType: 'chrome', name: 'Personal' }],
  });
  const profiles = fixture.profiles();
  profiles.push({
    id: 'racer',
    browserType: 'chrome',
    name: 'Personal',
    path: profilePath('chrome', 'Personal'),
  });
  fixture.setProfiles(profiles);
  const racedResult = await fixture.service?.executeImport({ token: preview?.token, decisions: [] });

  assert.deepEqual(racedResult, { success: false, code: 'IMPORT_PREVIEW_STALE' });
  assert.deepEqual(fixture.createdDirectories, []);
});

test('a later stale row prevents every directory creation in a multi-row import', async () => {
  const fixture = createFixture();
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [
      { browserType: 'chrome', name: 'Personal' },
      { browserType: 'firefox', name: 'Projects' },
    ],
  });
  fixture.setProfiles([{
    id: 'racer',
    browserType: 'firefox',
    name: 'Projects',
    path: profilePath('firefox', 'Projects'),
  }]);

  assert.deepEqual(
    await fixture.service?.executeImport({ token: preview?.token, decisions: [] }),
    { success: false, code: 'IMPORT_PREVIEW_STALE' },
  );
  assert.deepEqual(fixture.createdDirectories, []);
  assert.deepEqual(fixture.removedDirectories, []);
});

test('duplicate decisions must exactly match the duplicate rows stored with the preview token', async () => {
  const fixture = createFixture({
    profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work', path: profilePath('chrome', 'Work') }],
  });
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [
      { browserType: 'chrome', name: 'Work' },
      { browserType: 'firefox', name: 'Personal' },
    ],
  });

  for (const decisions of [
    [],
    [{ line: 1, action: 'skip' }, { line: 2, action: 'rename' }],
    [{ line: 3, action: 'skip' }],
  ]) {
    assert.deepEqual(
      await fixture.service?.executeImport({ token: preview?.token, decisions }),
      { success: false, code: 'IMPORT_DECISIONS_INVALID' },
    );
  }
  assert.deepEqual(fixture.createdDirectories, []);
});

test('skip remains a skip and rename remains a clone when a previewed duplicate disappears', async () => {
  for (const [action, expectedNames] of [
    ['skip', []],
    ['rename', ['Work 副本']],
  ]) {
    const fixture = createFixture({
      profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work', path: profilePath('chrome', 'Work') }],
    });
    const preview = await fixture.service?.previewImport({
      version: 1,
      profiles: [{ browserType: 'chrome', name: 'Work' }],
    });
    fixture.setProfiles([]);

    assert.equal((await fixture.service?.executeImport({
      token: preview?.token,
      decisions: [{ line: 1, action }],
    }))?.success, true);
    assert.deepEqual(fixture.profiles().map((profile) => profile.name), expectedNames);
  }
});

test('execute rolls back profile records and only new empty directories when a directory creation fails', async () => {
  const fixture = createFixture({
    profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work', path: profilePath('chrome', 'Work') }],
    failCreateAt: 2,
  });
  const before = fixture.profiles();
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [
      { browserType: 'firefox', name: 'Personal' },
      { browserType: 'edge', name: 'Projects' },
    ],
  });

  const result = await fixture.service?.executeImport({ token: preview?.token, decisions: [] });

  assert.deepEqual(result, { success: false, code: 'IMPORT_EXECUTION_FAILED' });
  assert.deepEqual(fixture.profiles(), before);
  assert.deepEqual(fixture.removedDirectories, [profilePath('firefox', 'Personal')]);
});

test('an EEXIST race rolls back only earlier exclusively created directories', async () => {
  const fixture = createFixture({
    failCreateAt: 2,
    failCreateCode: 'EEXIST',
    createFailureLeavesPath: true,
  });
  const racedPath = profilePath('edge', 'Projects');
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [
      { browserType: 'firefox', name: 'Personal' },
      { browserType: 'edge', name: 'Projects' },
    ],
  });

  assert.deepEqual(
    await fixture.service?.executeImport({ token: preview?.token, decisions: [] }),
    { success: false, code: 'IMPORT_DIRECTORY_CONFLICT' },
  );
  assert.deepEqual(fixture.removedDirectories, [profilePath('firefox', 'Personal')]);
  assert.equal(fixture.hasDirectory(racedPath), true);
});

test('an existing orphan directory is never adopted or removed by import', async () => {
  const existingPath = profilePath('firefox', 'Personal');
  const fixture = createFixture({ existingPaths: [existingPath] });
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [{ browserType: 'firefox', name: 'Personal' }],
  });

  assert.deepEqual(
    await fixture.service?.executeImport({ token: preview?.token, decisions: [] }),
    { success: false, code: 'IMPORT_DIRECTORY_CONFLICT' },
  );
  assert.deepEqual(fixture.removedDirectories, []);
  assert.equal(fixture.hasDirectory(existingPath), true);
});

test('rollback never removes a directory from a failed creation attempt', async () => {
  const fixture = createFixture({ failCreateAt: 1, createFailureLeavesPath: true });
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [{ browserType: 'firefox', name: 'Personal' }],
  });

  assert.deepEqual(
    await fixture.service?.executeImport({ token: preview?.token, decisions: [] }),
    { success: false, code: 'IMPORT_EXECUTION_FAILED' },
  );
  assert.deepEqual(fixture.removedDirectories, []);
});

test('rollback continues cleaning batch directories when restoring the profile snapshot throws', async () => {
  const fixture = createFixture({ failCreateAt: 2, throwSetProfilesAt: 1 });
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [
      { browserType: 'firefox', name: 'Personal' },
      { browserType: 'edge', name: 'Projects' },
    ],
  });

  assert.deepEqual(
    await fixture.service?.executeImport({ token: preview?.token, decisions: [] }),
    { success: false, code: 'IMPORT_ROLLBACK_INCOMPLETE' },
  );
  assert.deepEqual(fixture.removedDirectories, [profilePath('firefox', 'Personal')]);
});

test('preview tokens expire, have a hard capacity, bind normalized metadata, and cannot be replayed', async () => {
  let clock = 0;
  const fixture = createFixture({ now: () => clock, maxPreviewTokens: 2 });
  const first = await fixture.service?.previewImport({
    version: 1,
    profiles: [{ browserType: 'chrome', name: 'Work', ignored: 'one' }],
  });
  const sameMetadata = await fixture.service?.previewImport({
    version: 1,
    profiles: [{ name: 'Work', browserType: 'chrome', ignored: 'two' }],
  });
  const capped = await fixture.service?.previewImport({
    version: 1,
    profiles: [{ browserType: 'chrome', name: 'Projects' }],
  });

  assert.notEqual(first?.token, sameMetadata?.token);
  assert.equal(first?.documentDigest, sameMetadata?.documentDigest);
  assert.match(first?.token || '', /^[a-f0-9]{64}$/u);
  assert.deepEqual(capped?.token, null);
  assert.equal(capped?.code, 'IMPORT_PREVIEW_CAPACITY_REACHED');

  assert.equal((await fixture.service?.executeImport({ token: first?.token, decisions: [] }))?.success, true);
  assert.deepEqual(
    await fixture.service?.executeImport({ token: first?.token, decisions: [] }),
    { success: false, code: 'IMPORT_TOKEN_REPLAYED' },
  );

  clock = (10 * 60 * 1000) + 1;
  assert.deepEqual(
    await fixture.service?.executeImport({ token: sameMetadata?.token, decisions: [] }),
    { success: false, code: 'IMPORT_TOKEN_EXPIRED' },
  );
});
