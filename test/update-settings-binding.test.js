const test = require('node:test');
const assert = require('node:assert/strict');
const { bindUpdateSettingsCheckbox } = require('../renderer/update-settings-binding');

function deferred() {
  let resolve;
  return { promise: new Promise((next) => { resolve = next; }), resolve };
}

function checkbox() {
  const listeners = new Map();
  return {
    checked: true,
    disabled: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    async change(value) {
      this.checked = value;
      await listeners.get('change')({ currentTarget: this });
    },
  };
}

test('update setting binding blocks programmatic changes until load and single-flights a pending save', async () => {
  const input = checkbox();
  const loading = deferred();
  const saving = deferred();
  let saves = 0;
  const binding = bindUpdateSettingsCheckbox({
    checkbox: input,
    getAppSettings: () => loading.promise,
    setAppSettings: () => { saves += 1; return saving.promise; },
    showError: () => assert.fail('success must not show an error'),
  });
  const load = binding.load();
  await input.change(false);
  assert.equal(saves, 0);
  assert.equal(input.disabled, true);
  loading.resolve({ checkUpdatesOnStartup: false });
  await load;
  assert.equal(input.checked, false);
  const first = input.change(true);
  await Promise.resolve();
  const second = input.change(false);
  assert.equal(saves, 1);
  assert.equal(input.disabled, true);
  assert.equal(input.checked, true);
  saving.resolve({ success: true, settings: { checkUpdatesOnStartup: true } });
  await Promise.all([first, second]);
  assert.equal(input.checked, true);
  assert.equal(input.disabled, false);
});

test('update setting binding rolls back after a failed save', async () => {
  const input = checkbox();
  let errors = 0;
  const binding = bindUpdateSettingsCheckbox({
    checkbox: input,
    getAppSettings: async () => ({ checkUpdatesOnStartup: false }),
    setAppSettings: async () => ({ success: false }),
    showError: () => { errors += 1; },
  });
  await binding.load();
  await input.change(true);
  assert.equal(input.checked, false);
  assert.equal(input.disabled, false);
  assert.equal(errors, 1);
});
