const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');

let reader = {};
try {
  reader = require('../lib/import-reader');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('reads an import through one bounded file handle', async (context) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'browser-import-'));
  context.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'profiles.json');
  await fsp.writeFile(filePath, '{"profiles":[]}');

  assert.equal(
    await reader.readTextFileBounded?.(filePath, { maxBytes: 32 }),
    '{"profiles":[]}',
  );
});

test('rejects oversized and non-regular import paths', async (context) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'browser-import-'));
  context.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'large.json');
  await fsp.writeFile(filePath, '12345');

  await assert.rejects(
    reader.readTextFileBounded?.(filePath, { maxBytes: 4 }),
    /too large/u,
  );
  await assert.rejects(
    reader.readTextFileBounded?.(directory, { maxBytes: 32 }),
    /regular file/u,
  );
});
