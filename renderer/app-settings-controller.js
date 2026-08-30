function hasCloseToTraySetting(settings) {
  return Boolean(
    settings
    && typeof settings === 'object'
    && !Array.isArray(settings)
    && typeof settings.closeToTray === 'boolean',
  );
}

function createAppSettingsController({ getAppSettings, setAppSettings }) {
  let persistedSettings = { closeToTray: true };
  let loaded = false;

  async function load() {
    loaded = false;
    try {
      const settings = await getAppSettings();
      if (hasCloseToTraySetting(settings)) {
        persistedSettings = { closeToTray: settings.closeToTray };
      }
    } catch {
      // Keep the stable default when loading cannot complete.
    }
    loaded = true;
    return { ...persistedSettings };
  }

  async function save(patch) {
    const previous = { ...persistedSettings };
    if (!loaded) {
      return {
        success: false,
        settings: previous,
        error: 'Unable to save app settings',
      };
    }
    try {
      const result = await setAppSettings(patch);
      if (result?.success === true && hasCloseToTraySetting(result.settings)) {
        persistedSettings = { closeToTray: result.settings.closeToTray };
        return { success: true, settings: { ...persistedSettings } };
      }
    } catch {
      // The renderer only presents a stable error message.
    }
    return {
      success: false,
      settings: previous,
      error: 'Unable to save app settings',
    };
  }

  return {
    load,
    save,
    isLoaded: () => loaded,
    getCurrent: () => ({ ...persistedSettings }),
  };
}

if (typeof module !== 'undefined') module.exports = { createAppSettingsController };
if (typeof window !== 'undefined') window.createAppSettingsController = createAppSettingsController;
