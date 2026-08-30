const STABLE_SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const RELEASE_URL_PATTERN = /^https:\/\/github\.com\/WinterSoHot\/browser-multi-instance-manager\/releases\/tag\/v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$/u;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;
const UPDATE_ERROR_CODES = new Set([
  'UPDATE_CHECK_TIMEOUT',
  'UPDATE_CHECK_NETWORK_ERROR',
  'UPDATE_CHECK_HTTP_ERROR',
  'UPDATE_CHECK_RATE_LIMITED',
  'UPDATE_CHECK_REDIRECT',
  'UPDATE_CHECK_RESPONSE_TOO_LARGE',
  'UPDATE_CHECK_RESPONSE_INVALID',
  'UPDATE_CHECK_ABORTED',
]);

function createValidationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const match = STABLE_SEMVER_PATTERN.exec(version);
  if (!match) return null;

  const parsed = match.slice(1, 4).map(Number);
  return parsed.every(Number.isSafeInteger) ? parsed : null;
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) throw createValidationError('INVALID_SEMVER');

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function validateReleaseUrl(releaseUrl) {
  if (typeof releaseUrl !== 'string') {
    throw createValidationError('INVALID_RELEASE_URL');
  }

  const match = RELEASE_URL_PATTERN.exec(releaseUrl);
  const version = match?.[1];
  if (!version || !parseSemver(version)) {
    throw createValidationError('INVALID_RELEASE_URL');
  }
  return version;
}

function isPlainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function ownDataValue(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function validateReleaseResponse(response) {
  try {
    if (!isPlainRecord(response)) throw createValidationError('INVALID_RELEASE_RESPONSE');

    const tagName = ownDataValue(response, 'tag_name');
    const releaseUrl = ownDataValue(response, 'html_url');
    const draft = ownDataValue(response, 'draft');
    const prerelease = ownDataValue(response, 'prerelease');
    if (typeof tagName !== 'string' || typeof releaseUrl !== 'string'
      || draft !== false || prerelease !== false || !tagName.startsWith('v')) {
      throw createValidationError('INVALID_RELEASE_RESPONSE');
    }

    const version = tagName.slice(1);
    if (!parseSemver(version) || validateReleaseUrl(releaseUrl) !== version) {
      throw createValidationError('INVALID_RELEASE_RESPONSE');
    }
    return { version, releaseUrl };
  } catch {
    throw createValidationError('INVALID_RELEASE_RESPONSE');
  }
}

function hasOnlyKeys(record, keys) {
  const actualKeys = Reflect.ownKeys(record);
  if (!actualKeys.every((key) => typeof key === 'string')) return false;
  actualKeys.sort();
  return actualKeys.length === keys.length
    && actualKeys.every((key, index) => key === keys[index]);
}

function validateCachedResult(result, currentVersion) {
  if (!isPlainRecord(result) || typeof result.status !== 'string') return null;

  if (result.status === 'current' && hasOnlyKeys(result, ['status'])) {
    return { status: 'current' };
  }
  if (!hasOnlyKeys(result, ['releaseUrl', 'status', 'version'])
    || result.status !== 'available'
    || typeof result.version !== 'string'
    || typeof result.releaseUrl !== 'string'
    || !parseSemver(result.version)) {
    return null;
  }
  try {
    if (validateReleaseUrl(result.releaseUrl) !== result.version
      || compareSemver(result.version, currentVersion) <= 0) {
      return null;
    }
  } catch {
    return null;
  }
  return { status: 'available', version: result.version, releaseUrl: result.releaseUrl };
}

function getValidCachedResult(cache, currentVersion, currentTime) {
  if (!cache || typeof cache.get !== 'function' || !Number.isSafeInteger(currentTime)) {
    return null;
  }
  try {
    const entry = cache.get();
    if (!isPlainRecord(entry) || !hasOnlyKeys(entry, ['checkedAt', 'checkedVersion', 'result'])
      || !Number.isSafeInteger(entry.checkedAt) || entry.checkedAt < 0
      || entry.checkedVersion !== currentVersion) {
      return null;
    }
    const age = currentTime - entry.checkedAt;
    if (!Number.isSafeInteger(age) || age < 0 || age >= CACHE_MAX_AGE_MS) return null;
    return validateCachedResult(entry.result, currentVersion);
  } catch {
    return null;
  }
}

function toUpdateErrorCode(error) {
  if (error?.code === 'INVALID_RELEASE_RESPONSE') return 'UPDATE_CHECK_RESPONSE_INVALID';
  return UPDATE_ERROR_CODES.has(error?.code) ? error.code : 'UPDATE_CHECK_FAILED';
}

function createUpdateChecker({
  currentVersion,
  requestLatestRelease,
  now = () => Date.now(),
  cache = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!parseSemver(currentVersion)) throw createValidationError('INVALID_CURRENT_VERSION');
  if (typeof requestLatestRelease !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw createValidationError('INVALID_CHECK_OPTIONS');
  }

  let inFlight = null;

  function cacheSuccessfulResult(result) {
    if (!cache || typeof cache.set !== 'function') return;
    let checkedAt;
    try {
      checkedAt = now();
    } catch {
      return;
    }
    if (!Number.isSafeInteger(checkedAt) || checkedAt < 0) return;
    try {
      cache.set({ checkedAt, checkedVersion: currentVersion, result });
    } catch {
      // Cache persistence never changes a validated network result.
    }
  }

  async function runNetworkCheck() {
    const controller = new AbortController();
    let timer = null;
    let didTimeout = false;
    const timeoutSignal = Symbol('update-check-timeout');
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        resolve(timeoutSignal);
      }, timeoutMs);
    });
    const request = Promise.resolve().then(() => requestLatestRelease({ signal: controller.signal }));
    request.catch(() => {});

    try {
      const response = await Promise.race([request, timeout]);
      if (response === timeoutSignal) {
        return { status: 'error', code: 'UPDATE_CHECK_TIMEOUT' };
      }

      const { version, releaseUrl } = validateReleaseResponse(response);
      const result = compareSemver(version, currentVersion) > 0
        ? { status: 'available', version, releaseUrl }
        : { status: 'current' };
      cacheSuccessfulResult(result);
      return result;
    } catch (error) {
      return {
        status: 'error',
        code: didTimeout ? 'UPDATE_CHECK_TIMEOUT' : toUpdateErrorCode(error),
      };
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (!controller.signal.aborted) controller.abort();
    }
  }

  function check(options = {}) {
    if (!isPlainRecord(options) || !hasOnlyKeys(options, Object.keys(options).sort())) {
      throw createValidationError('INVALID_CHECK_OPTIONS');
    }
    if (Object.keys(options).some((key) => key !== 'force')
      || (Object.hasOwn(options, 'force') && typeof options.force !== 'boolean')) {
      throw createValidationError('INVALID_CHECK_OPTIONS');
    }
    const force = options.force === true;

    if (inFlight) return inFlight;
    if (!force) {
      let currentTime;
      try {
        currentTime = now();
      } catch {
        currentTime = null;
      }
      const cachedResult = getValidCachedResult(cache, currentVersion, currentTime);
      if (cachedResult) return Promise.resolve({ status: 'cached', result: cachedResult });
    }

    inFlight = runNetworkCheck();
    inFlight.finally(() => {
      inFlight = null;
    }).catch(() => {});
    return inFlight;
  }

  return { check };
}

module.exports = {
  parseSemver,
  compareSemver,
  validateReleaseUrl,
  validateReleaseResponse,
  createUpdateChecker,
};
