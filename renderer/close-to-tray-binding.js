function bindCloseToTrayCheckbox({ checkbox, controller, showError }) {
  let saving = false;
  let pendingValue;

  function currentValue() {
    return controller.getCurrent().closeToTray;
  }

  function sync() {
    if (!saving) checkbox.checked = currentValue();
    checkbox.disabled = saving || !controller.isLoaded();
  }

  checkbox.addEventListener('change', async (event) => {
    const target = event.currentTarget;
    if (saving) {
      target.checked = pendingValue;
      target.disabled = true;
      return;
    }
    if (!controller.isLoaded() || target.disabled) {
      target.checked = currentValue();
      target.disabled = true;
      return;
    }

    pendingValue = target.checked;
    saving = true;
    target.disabled = true;
    try {
      const result = await controller.save({ closeToTray: pendingValue });
      target.checked = result.settings.closeToTray;
      if (!result.success) showError();
    } catch {
      target.checked = currentValue();
      showError();
    } finally {
      saving = false;
      pendingValue = undefined;
      target.disabled = !controller.isLoaded();
    }
  });

  return { sync };
}

if (typeof module !== 'undefined') module.exports = { bindCloseToTrayCheckbox };
if (typeof window !== 'undefined') window.bindCloseToTrayCheckbox = bindCloseToTrayCheckbox;
