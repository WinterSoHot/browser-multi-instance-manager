const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppSettingsController } = require('../renderer/app-settings-controller');
const { bindCloseToTrayCheckbox } = require('../renderer/close-to-tray-binding');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createCheckbox() {
  let changeListener;
  return {
    checked: true,
    disabled: true,
    addEventListener(name, listener) {
      assert.equal(name, 'change');
      changeListener = listener;
    },
    dispatchChange() {
      return changeListener({ currentTarget: this });
    },
  };
}

test('close-to-tray binding rejects programmatic changes while the persisted value is still loading', async () => {
  const settings = createDeferred();
  let setCalls = 0;
  const controller = createAppSettingsController({
    getAppSettings: () => settings.promise,
    setAppSettings: async () => {
      setCalls += 1;
      return { success: true, settings: { closeToTray: true } };
    },
  });
  const checkbox = createCheckbox();
  const binding = bindCloseToTrayCheckbox({ checkbox, controller, showError: () => {} });

  const loading = controller.load();
  binding.sync();
  checkbox.checked = false;
  await checkbox.dispatchChange();

  assert.equal(setCalls, 0);
  assert.equal(checkbox.disabled, true);
  assert.equal(checkbox.checked, true);

  settings.resolve({ closeToTray: false });
  assert.deepEqual(await loading, { closeToTray: false });
  binding.sync();
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.checked, false);
});

test('close-to-tray binding single-flights saves and corrects programmatic checkbox drift', async () => {
  const save = createDeferred();
  let setCalls = 0;
  const controller = createAppSettingsController({
    getAppSettings: async () => ({ closeToTray: false }),
    setAppSettings: () => {
      setCalls += 1;
      return save.promise;
    },
  });
  const checkbox = createCheckbox();
  const binding = bindCloseToTrayCheckbox({ checkbox, controller, showError: () => {} });

  await controller.load();
  binding.sync();
  checkbox.checked = true;
  const firstChange = checkbox.dispatchChange();
  assert.equal(setCalls, 1);
  assert.equal(checkbox.disabled, true);

  checkbox.checked = false;
  await checkbox.dispatchChange();
  assert.equal(setCalls, 1);
  assert.equal(checkbox.disabled, true);
  assert.equal(checkbox.checked, true);

  save.resolve({ success: true, settings: { closeToTray: true } });
  await firstChange;
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.checked, true);
});

test('close-to-tray binding restores the persisted value after a failed pending save', async () => {
  const controller = createAppSettingsController({
    getAppSettings: async () => ({ closeToTray: false }),
    setAppSettings: async () => ({ success: false }),
  });
  const checkbox = createCheckbox();
  let errors = 0;
  const binding = bindCloseToTrayCheckbox({
    checkbox,
    controller,
    showError: () => { errors += 1; },
  });

  await controller.load();
  binding.sync();
  checkbox.checked = true;
  await checkbox.dispatchChange();

  assert.equal(errors, 1);
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.checked, false);
});
