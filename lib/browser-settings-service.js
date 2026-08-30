const BROWSER_TYPES = ['chrome', 'firefox', 'edge', 'zen'];

function createBrowserSettingsService({
  appStore,
  enqueueMutation,
  normalizeExecutablePath,
  resolveInstalledPath,
  validateSettings,
  pathExists,
  getPlatform,
  showOpenDialog,
}) {
  function getDefaultPaths() {
    return Object.fromEntries(
      BROWSER_TYPES.map((browserType) => [
        browserType,
        resolveInstalledPath(browserType),
      ]),
    );
  }

  function get() {
    return appStore.getBrowserSettings();
  }

  function getExecutable(browserType) {
    const customPath = get()[browserType];
    if (customPath) {
      try {
        const validatedPath = validateSettings({ [browserType]: customPath })[browserType];
        return normalizeExecutablePath(browserType, validatedPath);
      } catch {
        return null;
      }
    }

    const detectedPath = resolveInstalledPath(browserType);
    return detectedPath
      ? normalizeExecutablePath(browserType, detectedPath)
      : null;
  }

  function set(settings) {
    return enqueueMutation(async () => {
      try {
        const validatedSettings = validateSettings(settings);
        for (const [browserType, configuredPath] of Object.entries(validatedSettings)) {
          if (!configuredPath) continue;
          const executablePath = normalizeExecutablePath(browserType, configuredPath);
          if (!(await pathExists(executablePath))) {
            throw new Error(`${browserType} executable does not exist`);
          }
        }
        appStore.setBrowserSettings(validatedSettings);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  function getDefaultPath(browserType) {
    return getDefaultPaths()[browserType] || '';
  }

  async function getEnvironment() {
    const settings = get();
    const defaultPaths = getDefaultPaths();
    const validity = {};
    for (const browserType of BROWSER_TYPES) {
      const selectedPath = settings[browserType] || defaultPaths[browserType];
      validity[browserType] = Boolean(
        selectedPath
        && await pathExists(normalizeExecutablePath(browserType, selectedPath)),
      );
    }
    return { platform: getPlatform(), settings, defaultPaths, validity };
  }

  async function browseFolder(defaultPath) {
    const result = await showOpenDialog({
      properties: ['openFile'],
      defaultPath: defaultPath || undefined,
      filters: [
        { name: 'Executables', extensions: ['exe', 'app', ''] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, path: null };
    }

    return { success: true, path: result.filePaths[0] };
  }

  return {
    get,
    set,
    getExecutable,
    getDefaultPath,
    getPlatform,
    getEnvironment,
    browseFolder,
  };
}

module.exports = { createBrowserSettingsService };
