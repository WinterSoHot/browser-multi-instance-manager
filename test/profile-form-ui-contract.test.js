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

test('add-profile submit preserves its form reference across profile creation', () => {
  const handler = getAddProfileSubmitHandler();
  const capture = handler.indexOf('const form = e.currentTarget;');
  const addProfile = handler.indexOf('await window.browserAPI.addProfile');
  const cleanup = handler.indexOf('delete form.dataset.busy;');

  assert.ok(capture >= 0, 'the submit handler captures the form before async work');
  assert.ok(capture < addProfile, 'the form capture happens before profile creation awaits');
  assert.ok(cleanup > addProfile, 'finally clears busy state through the captured form');
  assert.doesNotMatch(handler.slice(addProfile), /e\.currentTarget/u);
});
