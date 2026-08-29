const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SUPPORTED_BROWSER_TYPES = new Set(['chrome', 'firefox', 'edge', 'zen']);
const INVALID_PROFILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/u;
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_PROFILE_NAME_LENGTH = 80;

function isOutsideDirectory(relativePath) {
  return relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

function validateProfileInput(browserType, profileName) {
  if (!SUPPORTED_BROWSER_TYPES.has(browserType)) {
    throw new Error('Unsupported browser type');
  }

  if (
    typeof profileName !== 'string'
    || profileName.length === 0
    || profileName.length > MAX_PROFILE_NAME_LENGTH
    || profileName !== profileName.trim()
    || profileName === '.'
    || profileName === '..'
    || profileName.endsWith('.')
    || WINDOWS_RESERVED_NAME_PATTERN.test(profileName)
    || INVALID_PROFILE_NAME_PATTERN.test(profileName)
  ) {
    throw new Error('Invalid profile name');
  }

  return { browserType, profileName };
}

function areProfileNamesEqual(leftName, rightName) {
  return leftName.normalize('NFC').toLocaleLowerCase()
    === rightName.normalize('NFC').toLocaleLowerCase();
}

function resolveProfilePath(baseDir, browserType, profileName) {
  validateProfileInput(browserType, profileName);

  const browserDir = path.resolve(baseDir, browserType);
  const profilePath = path.resolve(browserDir, profileName);
  const relativePath = path.relative(browserDir, profilePath);

  if (isOutsideDirectory(relativePath)) {
    throw new Error('Profile path escapes browser directory');
  }

  return profilePath;
}

function isStoredProfilePathSafe(baseDir, profile) {
  if (
    !profile
    || !SUPPORTED_BROWSER_TYPES.has(profile.browserType)
    || typeof profile.name !== 'string'
    || typeof profile.path !== 'string'
  ) {
    return false;
  }

  const browserDir = path.resolve(baseDir, profile.browserType);
  const expectedPath = path.resolve(browserDir, profile.name);
  const relativePath = path.relative(browserDir, expectedPath);
  const isInsideBrowserDir = !isOutsideDirectory(relativePath);

  return isInsideBrowserDir && path.resolve(profile.path) === expectedPath;
}

function createProfileRecord({ browserType, profileName, profilePath, createdAt }) {
  return {
    id: randomUUID(),
    browserType,
    name: profileName,
    path: profilePath,
    createdAt: createdAt || new Date().toISOString(),
  };
}

function validateBrowserSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Invalid browser settings');
  }

  const validatedSettings = {};
  for (const [browserType, executablePath] of Object.entries(settings)) {
    if (!SUPPORTED_BROWSER_TYPES.has(browserType)) {
      throw new Error('Unsupported browser type');
    }
    if (
      typeof executablePath !== 'string'
      || executablePath.length > 4096
      || (executablePath !== '' && !path.isAbsolute(executablePath))
    ) {
      throw new Error('Invalid browser executable path');
    }
    validatedSettings[browserType] = executablePath;
  }

  return validatedSettings;
}

module.exports = {
  SUPPORTED_BROWSER_TYPES,
  validateProfileInput,
  areProfileNamesEqual,
  resolveProfilePath,
  isStoredProfilePathSafe,
  validateBrowserSettings,
  createProfileRecord,
};
