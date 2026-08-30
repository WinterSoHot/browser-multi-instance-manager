const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function namedImportFor(modulePath) {
  const escapedModulePath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = mainSource.match(new RegExp(
    `const\\s+\\{([\\s\\S]*?)\\}\\s+=\\s+require\\(["']${escapedModulePath}["']\\);`,
  ));
  return match ? match[1].split(',').map((name) => name.trim()).filter(Boolean) : [];
}

test('main process imports the profile-path resolver used to create profile directories', () => {
  assert.match(
    mainSource,
    /function createProfileDir\(browserType, profileName\) \{[\s\S]*?resolveProfilePath\(/,
  );
  assert.ok(
    namedImportFor('./lib/profile-utils').includes('resolveProfilePath'),
    'main.js must import resolveProfilePath before createProfileDir can create a profile directory',
  );
});
