const { validateAppSettings, validateAppSettingsPatch } = require('./app-store');

function createAppSettingsService({ appStore, enqueueMutation }) {
  function get() {
    return validateAppSettings(appStore.getAppSettings());
  }

  async function set(patch) {
    const validatedPatch = validateAppSettingsPatch(patch);
    return enqueueMutation(async () => {
      const settings = validateAppSettings({ ...get(), ...validatedPatch });
      appStore.setAppSettings(settings);
      return { success: true, settings: { ...settings } };
    });
  }

  return { get, set };
}

module.exports = { createAppSettingsService };
