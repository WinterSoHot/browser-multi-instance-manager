const { validateAppSettings } = require('./app-store');

function validatePatch(patch) {
  if (
    !patch
    || typeof patch !== 'object'
    || Array.isArray(patch)
    || Object.keys(patch).length !== 1
    || !Object.prototype.hasOwnProperty.call(patch, 'closeToTray')
    || typeof patch.closeToTray !== 'boolean'
  ) {
    throw new Error('Invalid app settings');
  }
  return { closeToTray: patch.closeToTray };
}

function createAppSettingsService({ appStore, enqueueMutation }) {
  function get() {
    return validateAppSettings(appStore.getAppSettings());
  }

  async function set(patch) {
    const validatedPatch = validatePatch(patch);
    return enqueueMutation(async () => {
      const settings = validateAppSettings({ ...get(), ...validatedPatch });
      appStore.setAppSettings(settings);
      return { success: true, settings: { ...settings } };
    });
  }

  return { get, set };
}

module.exports = { createAppSettingsService };
