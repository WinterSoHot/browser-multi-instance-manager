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

test('import dialog keeps the two-phase confirmation contract in the renderer', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'renderer', 'index.js'), 'utf8');

  assert.match(html, /id="importPreviewModal"/u);
  assert.match(html, /id="importPreviewBody"/u);
  assert.match(html, /import-preview\.js/u);
  assert.match(source, /window\.browserAPI\.previewImport\(/u);
  assert.match(source, /window\.browserAPI\.executeImport\(/u);
  assert.match(source, /importPreviewBusy/u);
  assert.match(source, /buildImportDecisions/u);
});
