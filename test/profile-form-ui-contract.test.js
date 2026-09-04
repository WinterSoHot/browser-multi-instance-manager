const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.js'), 'utf8');

function getAddProfileSubmitHandler() {
  const start = source.indexOf("document.getElementById('addProfileForm').addEventListener('submit'");
  const end = source.indexOf('\n});', start) + 4;
  return source.slice(start, end);
}

function getFinallyBlock(handler) {
  const start = handler.indexOf('} finally {');
  const end = handler.indexOf('\n  }\n});', start) + '\n  }'.length;
  return handler.slice(start, end);
}

test('add-profile submit preserves its form reference across profile creation', () => {
  const handler = getAddProfileSubmitHandler();
  const capture = handler.indexOf('const form = e.currentTarget;');
  const addProfile = handler.indexOf('await window.browserAPI.addProfile');
  const finallyBlock = getFinallyBlock(handler);

  assert.ok(capture >= 0, 'the submit handler captures the form before async work');
  assert.ok(capture < addProfile, 'the form capture happens before profile creation awaits');
  assert.doesNotMatch(handler.slice(addProfile), /e\.currentTarget/u);
  assert.ok(finallyBlock.startsWith('} finally {'));
  assert.match(finallyBlock, /delete form\.dataset\.busy;/u);
  assert.match(finallyBlock, /submitButton\.disabled = false;/u);
});
