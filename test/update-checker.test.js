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
const createUpdateChecker = updateChecker.createUpdateChecker || (() => ({
  check: async () => ({ status: 'missing' }),
}));

const RELEASE_URL = 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0';

function assertStableFailure(operation, code, unsafeValue) {
  assert.throws(operation, (error) => (
    error?.code === code
    && error.message === code
    && !error.message.includes(unsafeValue)
  ));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function release(version) {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
  };
}

function cacheEntry(checkedAt, checkedVersion, result) {
  return { checkedAt, checkedVersion, result };
}

function createCache(initialValue = null) {
  let value = initialValue;
  const writes = [];
  return {
    get: () => value,
    set(next) {
      writes.push(next);
      value = next;
    },
    writes,
  };
}

function createChecker({
  currentVersion = '1.3.1',
  requestLatestRelease = async () => release('1.4.0'),
  now = () => 1_000_000,
  cache = createCache(),
  timeoutMs,
} = {}) {
  return createUpdateChecker({
    currentVersion,
    requestLatestRelease,
    now,
    cache,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
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

test('automatic checks use only a fresh cache bound to this app version', async () => {
  let requestCalls = 0;
  const cache = createCache(cacheEntry(1_000, '1.3.1', {
    status: 'available', version: '1.4.0', releaseUrl: RELEASE_URL,
  }));
  const checker = createChecker({
    now: () => 1_000 + (24 * 60 * 60 * 1000) - 1,
    cache,
    requestLatestRelease: async () => {
      requestCalls += 1;
      return release('1.5.0');
    },
  });

  assert.deepEqual(await checker.check(), {
    status: 'cached',
    result: { status: 'available', version: '1.4.0', releaseUrl: RELEASE_URL },
  });
  assert.equal(requestCalls, 0);
});

test('expired, future, malformed, version-mismatched, and stale available caches recheck', async () => {
  const hiddenCurrentResult = { status: 'current' };
  Object.defineProperty(hiddenCurrentResult, 'hidden', { value: true });
  const symbolCurrentResult = { status: 'current', [Symbol('hidden')]: true };
  const invalidCaches = [
    cacheEntry(1_001, '1.3.1', { status: 'current' }),
    cacheEntry(1_000, '1.3.0', { status: 'current' }),
    cacheEntry(1_000, '1.3.1', { status: 'available', version: '1.2.0', releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.2.0' }),
    cacheEntry(1_000, '1.3.1', { status: 'current', unexpected: true }),
    cacheEntry(1_000, '1.3.1', hiddenCurrentResult),
    cacheEntry(1_000, '1.3.1', symbolCurrentResult),
    cacheEntry(1_000, '1.3.1', { status: 'available', version: '1.4.0', releaseUrl: RELEASE_URL, unexpected: true }),
    { checkedAt: Number.NaN, checkedVersion: '1.3.1', result: { status: 'current' } },
    { checkedAt: 1_000, checkedVersion: '1.3.1', result: { status: 'available', version: '1.4.0' } },
  ];

  for (const cachedValue of invalidCaches) {
    let requestCalls = 0;
    const checker = createChecker({
      cache: createCache(cachedValue),
      now: () => 1_000,
      requestLatestRelease: async () => {
        requestCalls += 1;
        return release('1.4.0');
      },
    });

    assert.deepEqual(await checker.check(), {
      status: 'available', version: '1.4.0', releaseUrl: RELEASE_URL,
    });
    assert.equal(requestCalls, 1);
  }
});

test('a non-negative cache exactly 24 hours old rechecks while 24 hours minus one millisecond hits', async () => {
  const oneDay = 24 * 60 * 60 * 1000;
  let exactBoundaryRequests = 0;
  const exactBoundary = createChecker({
    now: () => oneDay + 1_000,
    cache: createCache(cacheEntry(1_000, '1.3.1', { status: 'current' })),
    requestLatestRelease: async () => {
      exactBoundaryRequests += 1;
      return release('1.3.1');
    },
  });
  const justFresh = createChecker({
    now: () => oneDay + 999,
    cache: createCache(cacheEntry(1_000, '1.3.1', { status: 'current' })),
    requestLatestRelease: async () => assert.fail('fresh cache must not request'),
  });

  assert.deepEqual(await exactBoundary.check(), { status: 'current' });
  assert.equal(exactBoundaryRequests, 1);
  assert.deepEqual(await justFresh.check(), { status: 'cached', result: { status: 'current' } });
});

test('forced and automatic checks share one in-flight request while force bypasses cache', async () => {
  const deferred = createDeferred();
  let requestCalls = 0;
  const cache = createCache(cacheEntry(1_000_000, '1.3.1', { status: 'current' }));
  const checker = createChecker({
    cache,
    requestLatestRelease: ({ signal }) => {
      requestCalls += 1;
      assert.equal(signal.aborted, false);
      return deferred.promise;
    },
  });

  const first = checker.check({ force: true });
  const second = checker.check();
  assert.strictEqual(first, second);
  deferred.resolve(release('1.4.0'));

  assert.deepEqual(await first, {
    status: 'available', version: '1.4.0', releaseUrl: RELEASE_URL,
  });
  assert.equal(requestCalls, 1);
  assert.equal(cache.writes.length, 1);
});

test('a timeout wins even when the request ignores abort and its late rejection is handled', async () => {
  const deferred = createDeferred();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const checker = createChecker({
      timeoutMs: 5,
      requestLatestRelease: () => deferred.promise,
    });
    assert.deepEqual(await checker.check({ force: true }), {
      status: 'error', code: 'UPDATE_CHECK_TIMEOUT',
    });
    deferred.reject(new Error('/private/remote-body'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('a timeout remains a timeout when the request immediately rejects after observing abort', async () => {
  const checker = createChecker({
    timeoutMs: 5,
    requestLatestRelease: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('request aborted');
        error.code = 'UPDATE_CHECK_ABORTED';
        reject(error);
      }, { once: true });
    }),
  });

  assert.deepEqual(await checker.check({ force: true }), {
    status: 'error', code: 'UPDATE_CHECK_TIMEOUT',
  });
});

test('network errors are stable, do not cache, and allow a later retry', async () => {
  let calls = 0;
  const cache = createCache();
  const checker = createChecker({
    cache,
    requestLatestRelease: async () => {
      calls += 1;
      if (calls === 1) throw new Error('/private/response-body');
      return release('1.3.1');
    },
  });

  assert.deepEqual(await checker.check({ force: true }), {
    status: 'error', code: 'UPDATE_CHECK_FAILED',
  });
  assert.equal(cache.writes.length, 0);
  assert.deepEqual(await checker.check({ force: true }), { status: 'current' });
  assert.equal(calls, 2);
  assert.equal(cache.writes.length, 1);
});

test('cache failures never suppress a network success and check options are strict', async () => {
  const checker = createChecker({
    cache: {
      get() { throw new Error('cache unavailable'); },
      set() { throw new Error('cache unavailable'); },
    },
  });

  assert.deepEqual(await checker.check(), {
    status: 'available', version: '1.4.0', releaseUrl: RELEASE_URL,
  });
  assert.throws(() => checker.check({ force: 'yes' }), (error) => error?.code === 'INVALID_CHECK_OPTIONS');
  assert.throws(() => createChecker({ currentVersion: 'v1.3.1' }), (error) => error?.code === 'INVALID_CURRENT_VERSION');
});
