const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let previewUi = {};
try {
  previewUi = require('../renderer/import-preview');
} catch {
  // The first TDD run intentionally exercises the missing renderer helper.
}

test('buildImportDecisions sends only row actions for duplicate rows', () => {
  const preview = {
    duplicates: [
      { line: 2, browserType: 'chrome', name: 'Work' },
      { line: 4, browserType: 'firefox', name: 'Personal' },
    ],
  };

  assert.deepEqual(
    previewUi.buildImportDecisions?.(preview, 'rename'),
    [{ line: 2, action: 'rename' }, { line: 4, action: 'rename' }],
  );
  assert.deepEqual(previewUi.buildImportDecisions?.(preview, 'skip'), [
    { line: 2, action: 'skip' },
    { line: 4, action: 'skip' },
  ]);
  assert.deepEqual(previewUi.buildImportDecisions?.(preview, 'unsafe'), []);
});

test('preview markup exposes counts, row details, and a disabled confirm control for invalid rows', () => {
  const markup = previewUi.renderImportPreview?.({
    valid: [{ line: 1, browserType: 'chrome', name: 'Work' }],
    duplicates: [{ line: 2, browserType: 'chrome', name: 'work' }],
    invalid: [{ line: 3, code: 'INVALID_PROFILE_METADATA' }],
  });

  assert.match(markup || '', /id="importPreviewValidCount"[^>]*>1/u);
  assert.match(markup || '', /id="importPreviewDuplicateCount"[^>]*>1/u);
  assert.match(markup || '', /id="importPreviewInvalidCount"[^>]*>1/u);
  assert.match(markup || '', /第 3 行/u);
  assert.match(markup || '', /id="confirmImportPreview"[^>]*disabled/u);
});

test('import preview state allows one submission, closes failed requests, and ignores an old completion', () => {
  const first = { code: 'OK', token: 'a'.repeat(64), valid: [], duplicates: [], invalid: [] };
  const second = { code: 'OK', token: 'b'.repeat(64), valid: [], duplicates: [], invalid: [] };
  const state = previewUi.createImportPreviewState?.();

  assert.equal(state?.open(first), true);
  assert.equal(state?.canCancel(), true);
  assert.deepEqual(state?.startExecute(), { token: first.token });
  assert.equal(state?.startExecute(), null, 'double-click must not issue another execute');
  assert.equal(state?.canCancel(), false, 'cancel must be blocked while execute is pending');
  assert.equal(state?.finish(first.token), true, 'a failed or successful request closes its preview');
  assert.equal(state?.getSnapshot().preview, null);

  assert.equal(state?.open(second), true);
  assert.equal(state?.finish(first.token), false, 'an old response must not clear a new preview');
  assert.equal(state?.getSnapshot().preview.token, second.token);
});

test('only an OK preview with an opaque token can be confirmed', () => {
  const valid = { code: 'OK', token: 'a'.repeat(64), valid: [], duplicates: [], invalid: [] };
  assert.equal(previewUi.isConfirmableImportPreview?.(valid), true);
  assert.equal(previewUi.isConfirmableImportPreview?.({ ...valid, code: 'IMPORT_PREVIEW_CAPACITY_REACHED', token: null }), false);
  assert.equal(previewUi.isConfirmableImportPreview?.({ ...valid, invalid: [{ line: 1 }] }), false);
});

test('import dialog keeps the two-phase confirmation contract in the renderer', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'renderer', 'index.js'), 'utf8');

  assert.match(html, /id="importPreviewModal"/u);
  assert.match(html, /id="importPreviewBody"/u);
  assert.match(html, /import-preview\.js/u);
  assert.match(source, /window\.browserAPI\.previewImport\(/u);
  assert.match(source, /window\.browserAPI\.executeImport\(/u);
  assert.match(source, /createImportPreviewState/u);
  assert.match(source, /buildImportDecisions/u);
  assert.match(source, /classList\.add\('show'\)/u);
  assert.doesNotMatch(source, /importPreviewModal'\)\.classList\.add\('active'\)/u);
  assert.match(source, /cancelImportPreview'\)\.disabled = false/u);
});
