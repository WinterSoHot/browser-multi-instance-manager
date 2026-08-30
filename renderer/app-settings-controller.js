function isAppSettings(settings) {
  return Boolean(
    settings
    && typeof settings === 'object'
    && !Array.isArray(settings)
    && Object.keys(settings).length === 1
    && Object.prototype.hasOwnProperty.call(settings, 'closeToTray')
    && typeof settings.closeToTray === 'boolean',
  );
}

function createAppSettingsController({ getAppSettings, setAppSettings }) {
  let persistedSettings = { closeToTray: true };

  async function load() {
    const settings = await getAppSettings();
    if (isAppSettings(settings)) persistedSettings = { ...settings };
    return { ...persistedSettings };
  }

  async function save(patch) {
    const previous = { ...persistedSettings };
    try {
      const result = await setAppSettings(patch);
      if (result?.success === true && isAppSettings(result.settings)) {
        persistedSettings = { ...result.settings };
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

  return { load, save };
}

if (typeof module !== 'undefined') module.exports = { createAppSettingsController };
if (typeof window !== 'undefined') window.createAppSettingsController = createAppSettingsController;
