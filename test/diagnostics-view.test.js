const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDiagnosticsViewState,
  createModalFocusManager,
  getDiagnosticBadge,
  sanitizeDiagnostic,
} = require('../renderer/diagnostics-view');

test('diagnostic view exposes only recognized recovery actions', () => {
  assert.deepEqual(sanitizeDiagnostic({
    code: 'PROFILE_DIRECTORY_MISSING',
    state: 'profile-directory-missing',
    actions: ['retry', 'recreate-empty-directory', 'forget-process', 'terminate'],
  }), {
    code: 'PROFILE_DIRECTORY_MISSING',
    state: 'profile-directory-missing',
    actions: ['retry', 'recreate-empty-directory'],
  });
  assert.deepEqual(sanitizeDiagnostic({
    code: 'PROCESS_STATE_UNKNOWN',
    state: 'process-unknown',
    actions: ['recreate-empty-directory'],
  }), {
    code: 'PROCESS_STATE_UNKNOWN',
    state: 'process-unknown',
    actions: [],
  });
});

test('diagnostic badges use only stable state labels', () => {
  assert.deepEqual(getDiagnosticBadge({ state: 'browser-path-invalid' }), {
    label: '浏览器路径无效',
    className: 'diagnostic-badge browser-path-invalid',
  });
  assert.equal(getDiagnosticBadge({ state: 'healthy' }), null);
});

test('diagnostic view discards stale responses after retry or profile deletion', () => {
  const state = createDiagnosticsViewState();
  const first = state.begin('profile-1');
  const retry = state.begin('profile-1');
  const visibleIds = new Set(['profile-1']);

  assert.equal(state.accept(first, { state: 'process-unknown', actions: ['retry'] }, visibleIds), false);
  assert.equal(state.accept(retry, { state: 'healthy', actions: [] }, visibleIds), true);
  assert.deepEqual(state.get('profile-1'), { code: 'UNKNOWN', state: 'healthy', actions: [] });

  const deleteRequest = state.begin('profile-2');
  state.remove('profile-2');
  assert.equal(state.accept(deleteRequest, { state: 'healthy', actions: [] }, new Set()), false);
  assert.equal(state.get('profile-2'), null);
});

test('diagnostic modal focus manager targets the first action and loops at either tab boundary', () => {
  const retry = { id: 'retry' };
  const close = { id: 'close' };
  const manager = createModalFocusManager(() => [retry, close]);

  assert.equal(manager.getInitialFocusTarget({}), retry);
  assert.equal(manager.getNextFocusTarget({ container: {}, activeElement: close, shiftKey: false }), retry);
  assert.equal(manager.getNextFocusTarget({ container: {}, activeElement: retry, shiftKey: true }), close);
  assert.equal(manager.getNextFocusTarget({ container: {}, activeElement: {}, shiftKey: false }), retry);
});
