const path = require('node:path');

const MACOS_BUNDLE_EXECUTABLES = {
  chrome: 'Google Chrome',
  firefox: 'firefox',
  edge: 'Microsoft Edge',
  zen: 'zen',
};

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

module.exports = { normalizeBrowserExecutablePath };
