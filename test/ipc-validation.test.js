const test = require('node:test');
const assert = require('node:assert/strict');

let validation = {};
try {
  validation = require('../lib/ipc-validation');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('accepts a bounded list of unique non-empty profile IDs', () => {
  assert.deepEqual(
    validation.validateProfileIds?.(['work', 'work', 'personal']),
    ['work', 'personal'],
  );
});

test('rejects malformed or oversized profile status requests', () => {
  assert.throws(() => validation.validateProfileIds?.('work'), /array/u);
  assert.throws(() => validation.validateProfileIds?.(['']), /profile ID/u);
  assert.throws(
    () => validation.validateProfileIds?.(Array.from({ length: 1001 }, (_, i) => `p-${i}`)),
    /at most 1000/u,
  );
});

test('rejects profile imports larger than one MiB before reading them', () => {
  assert.equal(validation.validateImportFileSize?.(1024 * 1024), 1024 * 1024);
  assert.throws(
    () => validation.validateImportFileSize?.((1024 * 1024) + 1),
    /too large/u,
  );
});
