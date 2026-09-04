const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProfileCardMenuState,
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
