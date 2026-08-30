const path = require('node:path');
const fs = require('node:fs');

const MACOS_BUNDLE_EXECUTABLES = {
  chrome: 'Google Chrome',
  firefox: 'firefox',
  edge: 'Microsoft Edge',
  zen: 'zen',
};

const MACOS_APP_NAMES = {
  chrome: 'Google Chrome.app',
  firefox: 'Firefox.app',
  edge: 'Microsoft Edge.app',
  zen: 'Zen.app',
};

const WINDOWS_EXECUTABLES = {
  chrome: ['Google', 'Chrome', 'Application', 'chrome.exe'],
  firefox: ['Mozilla Firefox', 'firefox.exe'],
  edge: ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  zen: ['Zen Browser', 'zen.exe'],
};

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function getBrowserPathCandidates(browserType, platform = process.platform, env = process.env) {
  if (platform === 'darwin') {
    const appName = MACOS_APP_NAMES[browserType];
    if (!appName) return [];
    return uniquePaths([
      path.posix.join('/Applications', appName),
      env.HOME && path.posix.join(env.HOME, 'Applications', appName),
    ]);
  }

  if (platform === 'win32') {
    const executableParts = WINDOWS_EXECUTABLES[browserType];
    if (!executableParts) return [];
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)']];
    if (browserType === 'chrome' || browserType === 'edge') roots.push(env.LOCALAPPDATA);
    return uniquePaths(roots.map((root) => root && path.win32.join(root, ...executableParts)));
  }

  return [];
}

function resolveInstalledBrowserPath(
  browserType,
  {
    platform = process.platform,
    env = process.env,
    exists = fs.existsSync,
  } = {},
) {
  return getBrowserPathCandidates(browserType, platform, env).find(exists) || '';
}

function normalizeBrowserExecutablePath(browserType, configuredPath, platform = process.platform) {
  if (platform !== 'darwin' || !configuredPath.toLocaleLowerCase().endsWith('.app')) {
    return configuredPath;
  }

  const executableName = MACOS_BUNDLE_EXECUTABLES[browserType];
  if (!executableName) {
    return configuredPath;
  }

  return path.join(configuredPath, 'Contents', 'MacOS', executableName);
}

module.exports = {
  getBrowserPathCandidates,
  normalizeBrowserExecutablePath,
  resolveInstalledBrowserPath,
};
