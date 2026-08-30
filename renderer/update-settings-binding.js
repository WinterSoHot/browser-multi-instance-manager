function bindUpdateSettingsCheckbox({ checkbox, getAppSettings, setAppSettings, showError }) {
  let loaded = false;
  let saving = false;
  let persisted = true;
  let pending;

  function sync() {
    if (!saving) checkbox.checked = persisted;
    checkbox.disabled = !loaded || saving;
  }

  async function load() {
    loaded = false;
    sync();
    try {
      const settings = await getAppSettings();
      if (typeof settings?.checkUpdatesOnStartup === 'boolean') persisted = settings.checkUpdatesOnStartup;
    } catch {
      // Keep the stable enabled default.
    }
    loaded = true;
    sync();
  }

  checkbox.addEventListener('change', async (event) => {
    const target = event.currentTarget;
    if (!loaded || saving || target.disabled) {
      target.checked = saving ? pending : persisted;
      target.disabled = !loaded || saving;
      return;
    }
    pending = target.checked;
    saving = true;
    sync();
    try {
      const result = await setAppSettings({ checkUpdatesOnStartup: pending });
      if (result?.success === true && typeof result.settings?.checkUpdatesOnStartup === 'boolean') {
        persisted = result.settings.checkUpdatesOnStartup;
      } else {
        showError();
      }
    } catch {
      showError();
    } finally {
      saving = false;
      pending = undefined;
      sync();
    }
  });

  return { load, sync, isLoaded: () => loaded };
}

if (typeof module !== 'undefined') module.exports = { bindUpdateSettingsCheckbox };
if (typeof window !== 'undefined') window.bindUpdateSettingsCheckbox = bindUpdateSettingsCheckbox;
