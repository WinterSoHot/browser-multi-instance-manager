const test = require('node:test');
const assert = require('node:assert/strict');

let updateChecker = {};
try {
  updateChecker = require('../lib/update-checker');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

const parseSemver = updateChecker.parseSemver || (() => null);
const compareSemver = updateChecker.compareSemver || (() => Number.NaN);
const validateReleaseUrl = updateChecker.validateReleaseUrl || (() => {
  throw new Error('UPDATE_CHECKER_UNAVAILABLE');
});
const validateReleaseResponse = updateChecker.validateReleaseResponse || (() => {
  throw new Error('UPDATE_CHECKER_UNAVAILABLE');
});

const RELEASE_URL = 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0';

function assertStableFailure(operation, code, unsafeValue) {
  assert.throws(operation, (error) => (
    error?.code === code
    && error.message === code
    && !error.message.includes(unsafeValue)
  ));
}

test('parseSemver accepts only stable three-part safe-integer versions', () => {
  assert.deepEqual(parseSemver('0.0.0'), [0, 0, 0]);
  assert.deepEqual(parseSemver('1.20.300'), [1, 20, 300]);
  assert.deepEqual(parseSemver('9007199254740991.0.1'), [9007199254740991, 0, 1]);

  for (const value of [
    '', ' v1.2.3', '1.2.3 ', 'v1.2.3', '01.2.3', '1.02.3', '1.2.03',
    '1.2', '1.2.3.4', '1.2.3-beta', '1.2.3+build', '-1.2.3',
    '9007199254740992.0.0', null, 10203,
  ]) {
    assert.equal(parseSemver(value), null, `must reject ${String(value)}`);
  }
});

test('compareSemver compares numeric components without decimal concatenation', () => {
  assert.equal(compareSemver('2.0.0', '1.999.999'), 1);
  assert.equal(compareSemver('1.10.0', '1.9.999'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('0.0.9', '0.0.10'), -1);
  assertStableFailure(() => compareSemver('1.2', '1.2.3'), 'INVALID_SEMVER', '1.2');
});

test('validateReleaseUrl accepts only the raw canonical repository release URL', () => {
  assert.equal(validateReleaseUrl(RELEASE_URL), '1.4.0');

  for (const url of [
    'http://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
    'https://github.com.evil.example/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
    'https://github.com@evil.example/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
    'https://github.com:443/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
    'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0/',
    'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0?download=1',
    'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0#details',
    'https://github.com/wintersohot/browser-multi-instance-manager/releases/tag/v1.4.0',
    'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v%31.4.0',
    'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0/more',
  ]) {
    assertStableFailure(() => validateReleaseUrl(url), 'INVALID_RELEASE_URL', url);
  }
});

test('validateReleaseResponse filters a plain stable release to its safe public fields', () => {
  const result = validateReleaseResponse({
    tag_name: 'v1.4.0',
    html_url: RELEASE_URL,
    draft: false,
    prerelease: false,
    body: '<script>ignore this remote body</script>',
    assets: [{ browser_download_url: 'https://evil.example/payload' }],
  });

  assert.deepEqual(result, { version: '1.4.0', releaseUrl: RELEASE_URL });
  assert.deepEqual(Object.keys(result).sort(), ['releaseUrl', 'version']);
});

test('validateReleaseResponse rejects malformed, non-plain, and mismatched release records', () => {
  const inherited = Object.create({ tag_name: 'v1.4.0' });
  inherited.html_url = RELEASE_URL;
  inherited.draft = false;
  inherited.prerelease = false;
  const nullPrototype = Object.assign(Object.create(null), {
    tag_name: 'v1.4.0', html_url: RELEASE_URL, draft: false, prerelease: false,
  });

  for (const response of [
    null,
    [],
    inherited,
    nullPrototype,
    { tag_name: 'v1.4.0', html_url: RELEASE_URL, draft: true, prerelease: false },
    { tag_name: 'v1.4.0', html_url: RELEASE_URL, draft: false, prerelease: true },
    { tag_name: '1.4.0', html_url: RELEASE_URL, draft: false, prerelease: false },
    { tag_name: 'v1.4.0-beta', html_url: RELEASE_URL, draft: false, prerelease: false },
    { tag_name: 'v1.4.0', html_url: RELEASE_URL.replace('v1.4.0', 'v9.9.9'), draft: false, prerelease: false },
    { tag_name: 'v1.4.0', html_url: 'https://evil.example/release?body=secret', draft: false, prerelease: false },
  ]) {
    assertStableFailure(
      () => validateReleaseResponse(response),
      'INVALID_RELEASE_RESPONSE',
      'secret',
    );
  }
});
