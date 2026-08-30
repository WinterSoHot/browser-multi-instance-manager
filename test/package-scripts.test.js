const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');

test('uses Node test discovery without shell-dependent glob expansion', () => {
  assert.equal(packageJson.scripts.test, 'node --test');
});

test('packages only the runtime tray images required by installed builds', () => {
  const trayFiles = packageJson.build.files
    .filter((file) => file.startsWith('build/icons/'))
    .sort();

  assert.deepEqual(trayFiles, [
    'build/icons/trayIcon.png',
    'build/icons/trayTemplate.png',
    'build/icons/trayTemplate@2x.png',
  ]);
});
