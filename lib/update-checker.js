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

function readExactJsonRecord(record, keys) {
  try {
    if (!isPlainRecord(record)) return null;
    const actualKeys = Reflect.ownKeys(record);
    if (!actualKeys.every((key) => typeof key === 'string')) return null;
    actualKeys.sort();
    if (actualKeys.length !== keys.length
      || !actualKeys.every((key, index) => key === keys[index])) {
      return null;
    }

    const snapshot = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function sanitizeUpdateResult(result, currentVersion) {
  const current = readExactJsonRecord(result, ['status']);
  if (current?.status === 'current') return { status: 'current' };
  const available = readExactJsonRecord(result, ['releaseUrl', 'status', 'version']);
  if (available?.status === 'available' && typeof available.version === 'string'
    && typeof available.releaseUrl === 'string' && parseSemver(currentVersion)
    && parseSemver(available.version)) {
    try {
      if (validateReleaseUrl(available.releaseUrl) === available.version
        && compareSemver(available.version, currentVersion) > 0) {
        return { status: 'available', version: available.version, releaseUrl: available.releaseUrl };
      }
    } catch {
      // Stable failure below.
    }
  }
  const cached = readExactJsonRecord(result, ['result', 'status']);
  if (cached?.status === 'cached') {
    const nested = sanitizeUpdateResult(cached.result, currentVersion);
    if (nested.status === 'current' || nested.status === 'available') {
      return { status: 'cached', result: nested };
    }
  }
  const error = readExactJsonRecord(result, ['code', 'status']);
  if (error?.status === 'error' && (UPDATE_ERROR_CODES.has(error.code)
    || error.code === 'UPDATE_CHECK_FAILED')) {
    return { status: 'error', code: error.code };
  }
  return { status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED' };
}

function validateCachedResult(result, currentVersion) {
  const currentResult = readExactJsonRecord(result, ['status']);
  if (currentResult?.status === 'current') return { status: 'current' };

  const availableResult = readExactJsonRecord(result, ['releaseUrl', 'status', 'version']);
  if (!availableResult || availableResult.status !== 'available'
    || typeof availableResult.version !== 'string'
    || typeof availableResult.releaseUrl !== 'string'
    || !parseSemver(availableResult.version)) {
    return null;
  }
  try {
    if (validateReleaseUrl(availableResult.releaseUrl) !== availableResult.version
      || compareSemver(availableResult.version, currentVersion) <= 0) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    status: 'available',
    version: availableResult.version,
    releaseUrl: availableResult.releaseUrl,
  };
}

function getValidCachedResult(cache, currentVersion, currentTime) {
  if (!cache || typeof cache.get !== 'function' || !Number.isSafeInteger(currentTime)) {
    return null;
  }
  try {
    const entry = readExactJsonRecord(cache.get(), ['checkedAt', 'checkedVersion', 'result']);
    if (!entry || !Number.isSafeInteger(entry.checkedAt) || entry.checkedAt < 0
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
    const emptyOptions = readExactJsonRecord(options, []);
    const forceOptions = emptyOptions ? null : readExactJsonRecord(options, ['force']);
    if (!emptyOptions && (!forceOptions || typeof forceOptions.force !== 'boolean')) {
      throw createValidationError('INVALID_CHECK_OPTIONS');
    }
    const force = forceOptions?.force === true;

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
  sanitizeUpdateResult,
  createUpdateChecker,
};
