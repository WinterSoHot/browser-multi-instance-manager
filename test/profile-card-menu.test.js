const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProfileCardMenuState,
  getProfileCardMenuActionFocusTarget,
  getProfileCardMenuActivationType,
  nextProfileCardMenuItemIndex,
} = require('../renderer/profile-card-menu');

test('profile card menu state keeps at most one profile open', () => {
  const state = createProfileCardMenuState();
  state.open('profile-a');
  assert.deepEqual(state.getSnapshot(), { openProfileId: 'profile-a' });
  state.toggle('profile-b');
  assert.deepEqual(state.getSnapshot(), { openProfileId: 'profile-b' });
  state.toggle('profile-b');
  assert.deepEqual(state.getSnapshot(), { openProfileId: null });
});

test('profile card menu keyboard navigation wraps and supports edges', () => {
  assert.equal(nextProfileCardMenuItemIndex(0, 'ArrowUp', 5), 4);
  assert.equal(nextProfileCardMenuItemIndex(4, 'ArrowDown', 5), 0);
  assert.equal(nextProfileCardMenuItemIndex(2, 'Home', 5), 0);
  assert.equal(nextProfileCardMenuItemIndex(2, 'End', 5), 4);
  assert.equal(nextProfileCardMenuItemIndex(2, 'Escape', 5), null);
});

test('profile card menu action activation distinguishes keyboard from pointer clicks', () => {
  assert.equal(getProfileCardMenuActivationType(0), 'keyboard');
  assert.equal(getProfileCardMenuActivationType(1), 'pointer');
  assert.equal(getProfileCardMenuActivationType(2), 'pointer');
});

test('keyboard menu actions restore a surviving or replacement profile trigger', () => {
  const originalTrigger = { isConnected: true };
  const replacementTrigger = { isConnected: true };
  const fallback = { isConnected: true };
  assert.equal(getProfileCardMenuActionFocusTarget({
    activationType: 'keyboard',
    hasVisibleModal: false,
    originalTrigger,
    replacementTrigger,
    fallback,
  }), originalTrigger);
  originalTrigger.isConnected = false;
  assert.equal(getProfileCardMenuActionFocusTarget({
    activationType: 'keyboard',
    hasVisibleModal: false,
    originalTrigger,
    replacementTrigger,
    fallback,
  }), replacementTrigger);
});

test('keyboard menu actions fall back after removal but never steal focus from a modal', () => {
  const disconnectedTrigger = { isConnected: false };
  const fallback = { isConnected: true };
  assert.equal(getProfileCardMenuActionFocusTarget({
    activationType: 'keyboard',
    hasVisibleModal: false,
    originalTrigger: disconnectedTrigger,
    replacementTrigger: null,
    fallback,
  }), fallback);
  assert.equal(getProfileCardMenuActionFocusTarget({
    activationType: 'keyboard',
    hasVisibleModal: true,
    originalTrigger: disconnectedTrigger,
    replacementTrigger: null,
    fallback,
  }), null);
  assert.equal(getProfileCardMenuActionFocusTarget({
    activationType: 'pointer',
    hasVisibleModal: false,
    originalTrigger: fallback,
    replacementTrigger: null,
    fallback,
  }), null);
});
