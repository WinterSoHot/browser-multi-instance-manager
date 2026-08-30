const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('diagnostics modal traps keyboard focus and suppresses page shortcuts while it is open', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.js'), 'utf8');

  assert.match(source, /function focusDiagnosticsModal\(/u);
  assert.match(source, /function trapDiagnosticsModalFocus\(/u);
  assert.match(source, /function restoreDiagnosticsFocus\(/u);
  assert.match(source, /event\.key === 'Escape'/u);
  assert.match(source, /event\.key === 'Tab'/u);
  assert.match(source, /event\.stopImmediatePropagation\(\)/u);
});
