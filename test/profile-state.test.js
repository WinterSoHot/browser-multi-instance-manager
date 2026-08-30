const test = require('node:test');
const assert = require('node:assert/strict');

const { createProfileState } = require('../renderer/profile-state');

const profiles = [
  { id: 'chrome-1', browserType: 'chrome', name: 'Work' },
  { id: 'firefox-1', browserType: 'firefox', name: 'Personal' },
  { id: 'chrome-2', browserType: 'chrome', name: 'Research' },
];

test('filter changes remove hidden selections', () => {
  const state = createProfileState({ profiles });
  state.toggleSelection('chrome-1');
  state.toggleSelection('firefox-1');
  state.setFilter('chrome');

  assert.deepEqual(state.getSnapshot().selectedIds, ['chrome-1']);
});

test('query changes retain current trimmed case-insensitive search semantics', () => {
  const state = createProfileState({ profiles });
  state.toggleSelection('chrome-1');
  state.toggleSelection('chrome-2');
  state.setQuery(' WORK ');

  assert.deepEqual(state.getVisibleProfiles(), [profiles[0]]);
  assert.deepEqual(state.getSnapshot().selectedIds, ['chrome-1']);
});

test('profile replacements remove selections that are no longer visible', () => {
  const state = createProfileState({ profiles });
  state.toggleSelection('chrome-1');
  state.toggleSelection('firefox-1');
  state.setProfiles([profiles[1], profiles[2]]);

  assert.deepEqual(state.getSnapshot().selectedIds, ['firefox-1']);
});

test('selection toggles and clears without changing profile order', () => {
  const state = createProfileState({ profiles });
  state.toggleSelection('firefox-1');
  state.toggleSelection('chrome-1');
  state.toggleSelection('firefox-1');

  assert.deepEqual(state.getSnapshot().selectedIds, ['chrome-1']);
  assert.deepEqual(state.getVisibleProfiles(), profiles);

  state.clearSelection();
  assert.deepEqual(state.getSnapshot().selectedIds, []);
});

test('status and sort transitions are exposed through isolated snapshots', () => {
  const state = createProfileState({ profiles });
  state.setStatuses({
    runningIds: ['chrome-1'],
    unknownIds: ['firefox-1'],
    retryableCloseIds: ['firefox-1'],
  });
  state.setSort('recent-desc');

  const snapshot = state.getSnapshot();
  assert.deepEqual(snapshot.runningIds, ['chrome-1']);
  assert.deepEqual(snapshot.unknownIds, ['firefox-1']);
  assert.deepEqual(snapshot.retryableCloseIds, ['firefox-1']);
  assert.equal(snapshot.sort, 'recent-desc');

  snapshot.profiles[0].name = 'Changed outside';
  snapshot.runningIds.push('chrome-2');
  snapshot.selectedIds.push('chrome-2');

  assert.equal(state.getSnapshot().profiles[0].name, 'Work');
  assert.deepEqual(state.getSnapshot().runningIds, ['chrome-1']);
  assert.deepEqual(state.getSnapshot().selectedIds, []);
});
