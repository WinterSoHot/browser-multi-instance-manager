const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let browserPaths = {};
try {
  browserPaths = require('../lib/browser-paths');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

test('resolves supported macOS app bundles to their executable', () => {
  assert.equal(
    browserPaths.normalizeBrowserExecutablePath?.(
      'chrome',
      '/Applications/Google Chrome.app',
      'darwin',
    ),
    path.join(
      '/Applications/Google Chrome.app',
      'Contents',
      'MacOS',
      'Google Chrome',
    ),
  );
  assert.equal(
    browserPaths.normalizeBrowserExecutablePath?.(
      'firefox',
      '/Custom/Firefox.app',
      'darwin',
    ),
    path.join('/Custom/Firefox.app', 'Contents', 'MacOS', 'firefox'),
  );
});
test('leaves direct executable paths unchanged', () => {
  assert.equal(
    browserPaths.normalizeBrowserExecutablePath?.(
      'edge',
      'C:\\Program Files\\Edge\\msedge.exe',
      'win32',
    ),
    'C:\\Program Files\\Edge\\msedge.exe',
  );
  assert.equal(
    browserPaths.normalizeBrowserExecutablePath?.(
      'zen',
      '/Applications/Zen.app/Contents/MacOS/zen',
      'darwin',
    ),
    '/Applications/Zen.app/Contents/MacOS/zen',
  );
});
