const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let profileUtils = {};
try {
  profileUtils = require('../lib/profile-utils');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('accepts a normal Unicode profile name', () => {
  assert.deepEqual(
    profileUtils.validateProfileInput?.('chrome', '工作 1'),
    { browserType: 'chrome', profileName: '工作 1' },
  );
  assert.deepEqual(
    profileUtils.validateProfileInput?.('firefox', "John's profile"),
    { browserType: 'firefox', profileName: "John's profile" },
  );
});

test('rejects unsupported browser types', () => {
  assert.throws(
    () => profileUtils.validateProfileInput?.('safari', 'work'),
    /Unsupported browser type/,
  );
});

test('rejects names that can escape or alter a filesystem path', () => {
  for (const profileName of [
    '../outside',
    '..',
    'work/name',
    'work\\name',
    'x"; open -a Calculator; #',
    'CON',
    'work.',
  ]) {
    assert.throws(
      () => profileUtils.validateProfileInput?.('chrome', profileName),
      /Invalid profile name/,
      profileName,
    );
  }
});

test('treats case and Unicode-normalized profile names as the same directory name', () => {
  assert.equal(profileUtils.areProfileNamesEqual?.('Work', 'work'), true);
  assert.equal(profileUtils.areProfileNamesEqual?.('Café', 'Cafe\u0301'), true);
  assert.equal(profileUtils.areProfileNamesEqual?.('work', 'personal'), false);
});

test('resolves profile directories below the selected browser directory', () => {
  const baseDir = path.resolve(path.sep, 'app-data', 'profiles');
  assert.equal(
    profileUtils.resolveProfilePath?.(baseDir, 'firefox', '个人'),
    path.join(baseDir, 'firefox', '个人'),
  );
  assert.equal(
    profileUtils.resolveProfilePath?.(baseDir, 'chrome', '..work'),
    path.join(baseDir, 'chrome', '..work'),
  );
});

test('detects stored profile paths that do not match their controlled directory', () => {
  const baseDir = path.resolve(path.sep, 'app-data', 'profiles');
  assert.equal(
    profileUtils.isStoredProfilePathSafe?.(
      baseDir,
      { browserType: 'chrome', name: 'work', path: path.join(baseDir, 'chrome', 'work') },
    ),
    true,
  );
  assert.equal(
    profileUtils.isStoredProfilePathSafe?.(
      baseDir,
      { browserType: 'chrome', name: 'work', path: path.join(path.sep, 'tmp', 'work') },
    ),
    false,
  );
  assert.equal(
    profileUtils.isStoredProfilePathSafe?.(
      baseDir,
      {
        browserType: 'chrome',
        name: "legacy's profile",
        path: path.join(baseDir, 'chrome', "legacy's profile"),
      },
    ),
    true,
  );
  assert.equal(
    profileUtils.isStoredProfilePathSafe?.(
      baseDir,
      {
        browserType: 'chrome',
        name: '..work',
        path: path.join(baseDir, 'chrome', '..work'),
      },
    ),
    true,
  );
});

test('keeps process records only when they match a current safe profile', () => {
  const baseDir = path.resolve(path.sep, 'app-data', 'profiles');
  const profile = {
    id: 'profile-1',
    browserType: 'chrome',
    name: 'work',
    path: path.join(baseDir, 'chrome', 'work'),
  };
  const validRecord = {
    profileId: 'profile-1',
    browserType: 'chrome',
    profilePath: profile.path,
    executablePath: path.join(path.sep, 'Applications', 'Chrome'),
    pid: 123,
  };

  assert.deepEqual(
    profileUtils.filterRestorableProcessRecords?.(
      baseDir,
      [profile],
      [
        validRecord,
        { ...validRecord, profileId: 'deleted-profile' },
        { ...validRecord, browserType: 'edge' },
        { ...validRecord, profilePath: path.join(path.sep, 'tmp', 'work') },
      ],
    ),
    [validRecord],
  );
});

test('accepts only supported absolute browser executable settings', () => {
  assert.deepEqual(
    profileUtils.validateBrowserSettings?.({
      chrome: path.join(path.sep, 'Applications', 'Chrome'),
      firefox: '',
    }),
    {
      chrome: path.join(path.sep, 'Applications', 'Chrome'),
      firefox: '',
    },
  );
  assert.throws(
    () => profileUtils.validateBrowserSettings?.({ safari: '/Applications/Safari' }),
    /Unsupported browser type/,
  );
  assert.throws(
    () => profileUtils.validateBrowserSettings?.({ chrome: 'relative/chrome' }),
    /Invalid browser executable path/,
  );
});

test('creates unique IDs for profiles created in the same instant', () => {
  const input = {
    browserType: 'chrome',
    profileName: 'work',
    profilePath: path.join(path.sep, 'profiles', 'chrome', 'work'),
    createdAt: '2026-08-29T00:00:00.000Z',
  };
  const firstProfile = profileUtils.createProfileRecord?.(input);
  const secondProfile = profileUtils.createProfileRecord?.(input);

  assert.notEqual(firstProfile?.id, secondProfile?.id);
  assert.equal(firstProfile?.createdAt, input.createdAt);
});

test('treats profile names as unique within each browser type', () => {
  const profiles = [
    { id: 'chrome-work', browserType: 'chrome', name: 'Work' },
    { id: 'firefox-personal', browserType: 'firefox', name: 'Personal' },
  ];

  assert.equal(
    profileUtils.isDuplicateProfileName?.(profiles, 'chrome', 'work'),
    true,
  );
  assert.equal(
    profileUtils.isDuplicateProfileName?.(profiles, 'firefox', 'work'),
    false,
  );
  assert.equal(
    profileUtils.isDuplicateProfileName?.(profiles, 'chrome', 'work', 'chrome-work'),
    false,
  );
});

test('chooses a collision-free clone name within the same browser', () => {
  const profiles = [
    { browserType: 'chrome', name: 'Work' },
    { browserType: 'chrome', name: 'Work 副本' },
    { browserType: 'firefox', name: 'Work 副本 (2)' },
  ];

  assert.equal(
    profileUtils.createCloneProfileName?.(profiles, 'chrome', 'Work'),
    'Work 副本 (2)',
  );
});

test('keeps generated clone names within the profile-name length limit', () => {
  const generatedName = profileUtils.createCloneProfileName?.(
    [],
    'chrome',
    '一'.repeat(80),
  );

  assert.ok(generatedName.length <= 80);
  assert.doesNotThrow(() => profileUtils.validateProfileInput('chrome', generatedName));
});

test('exports and imports metadata without profile paths or credentials', () => {
  const document = profileUtils.createProfileExport?.([
    {
      id: 'secret-id',
      browserType: 'chrome',
      name: 'Work',
      path: '/private/profile',
      cookies: ['secret'],
    },
  ]);

  assert.deepEqual(document, {
    version: 1,
    profiles: [{ browserType: 'chrome', name: 'Work' }],
  });
  assert.deepEqual(
    profileUtils.validateProfileImportDocument?.(document),
    [{ browserType: 'chrome', name: 'Work' }],
  );
  assert.throws(
    () => profileUtils.validateProfileImportDocument?.({
      version: 1,
      profiles: [
        { browserType: 'chrome', name: 'Work' },
        { browserType: 'chrome', name: 'work' },
      ],
    }),
    /Duplicate profile metadata/,
  );
});
