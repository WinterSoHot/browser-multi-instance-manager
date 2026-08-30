const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let createImportExportService;
try {
  ({ createImportExportService } = require('../lib/import-export-service'));
} catch {
  // The first TDD run intentionally exercises the missing service.
}

function createFixture({
  profiles = [],
  failCreateAt = null,
  createFailureLeavesPath = false,
  now = () => 0,
  maxPreviewTokens,
} = {}) {
  let storedProfiles = structuredClone(profiles);
  const existingPaths = new Set(profiles.map((profile) => profile.path).filter(Boolean));
  const createdDirectories = [];
  const removedDirectories = [];
  let createCalls = 0;
  const service = createImportExportService({
    appStore: {
      getProfiles: () => structuredClone(storedProfiles),
      setProfiles(nextProfiles) {
        storedProfiles = structuredClone(nextProfiles);
      },
    },
    profileOperations: { runGlobalMutation: (operation) => operation() },
    getProfilePath: (browserType, profileName) => path.join('/profiles', browserType, profileName),
    pathExists: async (targetPath) => existingPaths.has(targetPath),
    createProfileDir: async (browserType, profileName) => {
      createCalls += 1;
      const targetPath = path.join('/profiles', browserType, profileName);
      if (createCalls === failCreateAt) {
        if (createFailureLeavesPath) existingPaths.add(targetPath);
        throw new Error('unavailable directory');
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
  };
}

test('preview classifies every row without filesystem or store side effects', async () => {
  const fixture = createFixture({
    profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work', path: '/profiles/chrome/Work' }],
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
    profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work', path: '/profiles/chrome/Work' }],
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
    '/profiles/chrome/Work 副本',
    '/profiles/chrome/work 副本 (2)',
    '/profiles/firefox/Personal',
  ]);
});

test('execute uses the current profiles snapshot and rejects a preview made stale by a new conflict', async () => {
  const fixture = createFixture();
  const preview = await fixture.service?.previewImport({
    version: 1,
    profiles: [{ browserType: 'chrome', name: 'Personal' }],
  });
  const profiles = fixture.profiles();
  profiles.push({ id: 'racer', browserType: 'chrome', name: 'Personal', path: '/profiles/chrome/Personal' });
  fixture.setProfiles(profiles);
  const racedResult = await fixture.service?.executeImport({ token: preview?.token, decisions: [] });

  assert.deepEqual(racedResult, { success: false, code: 'IMPORT_PREVIEW_STALE' });
  assert.deepEqual(fixture.createdDirectories, []);
});

test('execute rolls back profile records and only new empty directories when a directory creation fails', async () => {
  const fixture = createFixture({
    profiles: [{ id: 'p1', browserType: 'chrome', name: 'Work', path: '/profiles/chrome/Work' }],
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
  assert.deepEqual(fixture.removedDirectories, ['/profiles/firefox/Personal']);
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
