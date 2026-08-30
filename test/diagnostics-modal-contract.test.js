const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshDiagnosticsModalAfterAction } = require('../renderer/diagnostics-view');

test('diagnostic action refreshes and restores focus only while its modal remains active', async () => {
  const calls = [];
  const active = { profileId: 'profile-1', open: true };

  assert.equal(await refreshDiagnosticsModalAfterAction({
    profileId: 'profile-1',
    requestDiagnostics: async () => { calls.push('request'); },
    getOpenProfileId: () => active.profileId,
    isModalOpen: () => active.open,
    renderProfiles: () => { calls.push('profiles'); },
    renderDiagnosticsModal: () => { calls.push('modal'); },
    focusDiagnosticsModal: () => { calls.push('focus'); },
  }), true);
  assert.deepEqual(calls, ['request', 'profiles', 'modal', 'focus']);
});

test('diagnostic action does not steal focus after its modal closes or switches profile', async () => {
  for (const changeActiveState of [
    (active) => { active.open = false; },
    (active) => { active.profileId = 'profile-2'; },
  ]) {
    const calls = [];
    const active = { profileId: 'profile-1', open: true };

    assert.equal(await refreshDiagnosticsModalAfterAction({
      profileId: 'profile-1',
      requestDiagnostics: async () => { calls.push('request'); },
      getOpenProfileId: () => active.profileId,
      isModalOpen: () => active.open,
      renderProfiles: () => { calls.push('profiles'); },
      renderDiagnosticsModal: () => {
        calls.push('modal');
        changeActiveState(active);
      },
      focusDiagnosticsModal: () => { calls.push('focus'); },
    }), false);
    assert.deepEqual(calls, ['request', 'profiles', 'modal']);
  }
});
