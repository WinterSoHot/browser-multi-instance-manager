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

test('discovers browsers from macOS application locations in priority order', () => {
  const candidates = browserPaths.getBrowserPathCandidates?.(
    'chrome',
    'darwin',
    { HOME: '/Users/tester' },
  );

  assert.deepEqual(candidates, [
    '/Applications/Google Chrome.app',
    '/Users/tester/Applications/Google Chrome.app',
  ]);
  assert.equal(
    browserPaths.resolveInstalledBrowserPath?.('chrome', {
      platform: 'darwin',
      env: { HOME: '/Users/tester' },
      exists: (candidate) => candidate.startsWith('/Users/tester'),
    }),
    '/Users/tester/Applications/Google Chrome.app',
  );
});

test('discovers Windows machine and per-user browser installations', () => {
  assert.deepEqual(
    browserPaths.getBrowserPathCandidates?.('edge', 'win32', {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    }),
    [
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Users\\tester\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  );
});

test('returns an empty detected path when no candidate exists', () => {
  assert.equal(
    browserPaths.resolveInstalledBrowserPath?.('zen', {
      platform: 'win32',
      env: {},
      exists: () => false,
    }),
    '',
  );
});
