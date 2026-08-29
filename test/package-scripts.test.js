const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');

test('uses Node test discovery without shell-dependent glob expansion', () => {
  assert.equal(packageJson.scripts.test, 'node --test');
});
