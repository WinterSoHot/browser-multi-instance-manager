const STABLE_SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const RELEASE_URL_PATTERN = /^https:\/\/github\.com\/WinterSoHot\/browser-multi-instance-manager\/releases\/tag\/v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$/u;

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

module.exports = {
  parseSemver,
  compareSemver,
  validateReleaseUrl,
  validateReleaseResponse,
};
