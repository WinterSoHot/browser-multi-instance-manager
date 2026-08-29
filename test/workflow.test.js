const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing block start: ${start}`);

  const contentStart = startIndex + start.length;
  const endIndex = text.indexOf(end, contentStart);
  assert.notEqual(endIndex, -1, `Missing block end: ${end}`);

  return text.slice(contentStart, endIndex);
}

const topLevelBlock = workflow.slice(0, workflow.indexOf('jobs:\n'));
const triggerBlock = blockBetween(workflow, 'on:\n', '\njobs:\n');
const buildMacBlock = blockBetween(workflow, '  build-mac:\n', '\n  build-win:\n');
const buildWinBlock = blockBetween(workflow, '  build-win:\n', '\n  release:\n');
const releaseBlock = workflow.slice(workflow.indexOf('  release:\n'));
const versionTag = `v${packageJson.version}`;
const versionLiteralPattern = new RegExp(escapeRegExp(versionTag));
const packageJsonVersionReadPattern = /package\.json/;
const derivedVersionPattern = /v['"`]?\s*\+\s*.*version|version\s*\+\s*['"`]v['"`]|['"`]v['"`]\s*\+\s*.*version/;
const exportedTagPattern = /(outputs|env):[\s\S]*(tag|tag_name|release_tag|version_tag)/;
const dynamicTagReferencePattern = /(\$\{\{[^}]*steps\.[^}]*\.(outputs\.[^}\s]+|output\.[^}\s]+)[^}]*\}\}|\$[A-Z_]*(TAG|TAG_NAME|RELEASE_TAG|VERSION_TAG)\b)/;

test('release workflow validates main and pull requests before publishing', () => {
  assert.match(triggerBlock, /pull_request:/);
  assert.match(triggerBlock, /push:\n\s*branches:\n\s*-\s*main/);
  assert.doesNotMatch(triggerBlock, /\btags:\s*/);
  assert.match(buildMacBlock, /runs-on:\s*macos-latest/);
  assert.match(buildWinBlock, /runs-on:\s*windows-latest/);
  assert.match(buildMacBlock, /node-version:\s*'20'/);
  assert.match(buildWinBlock, /node-version:\s*'20'/);
  assert.match(buildMacBlock, /run:\s*npm test/);
  assert.match(buildWinBlock, /run:\s*npm test/);
  assert.match(buildMacBlock, /actions\/checkout@v5/);
  assert.match(buildMacBlock, /actions\/setup-node@v5/);
  assert.match(buildMacBlock, /actions\/upload-artifact@v6/);
  assert.match(buildWinBlock, /actions\/checkout@v5/);
  assert.match(buildWinBlock, /actions\/setup-node@v5/);
  assert.match(buildWinBlock, /actions\/upload-artifact@v6/);
  assert.match(releaseBlock, /actions\/download-artifact@v6/);
});

test('release workflow keeps permissions scoped to each job', () => {
  assert.doesNotMatch(topLevelBlock, /permissions:\n/);
  assert.doesNotMatch(topLevelBlock, /actions:\s*write/);
  assert.match(buildMacBlock, /permissions:\n\s*contents:\s*read\n\s*steps:/);
  assert.match(buildWinBlock, /permissions:\n\s*contents:\s*read\n\s*steps:/);
  assert.doesNotMatch(buildMacBlock, /actions:\s*write/);
  assert.doesNotMatch(buildWinBlock, /actions:\s*write/);
  assert.match(releaseBlock, /permissions:\n\s*contents:\s*write\n\s*steps:/);
  assert.doesNotMatch(releaseBlock, /permissions:\n[\s\S]*actions:\s*write/);
});

test('release workflow derives and uses a dynamic version tag', () => {
  assert.match(releaseBlock, packageJsonVersionReadPattern);
  assert.match(releaseBlock, derivedVersionPattern);
  assert.match(releaseBlock, exportedTagPattern);
  assert.match(releaseBlock, dynamicTagReferencePattern);
  assert.match(releaseBlock, /git tag -a/);
  assert.match(releaseBlock, /gh release create/);
  assert.match(releaseBlock, /git show-ref --tags --verify --quiet/);
  assert.match(releaseBlock, /refs\/tags/);
  assert.doesNotMatch(releaseBlock, /git tag\b[^\n]*\s--force\b/);
  assert.doesNotMatch(releaseBlock, /git tag\b[^\n]*\s-f\b/);
  assert.doesNotMatch(releaseBlock, /git push\b[^\n]*\s--force\b/);
  assert.doesNotMatch(releaseBlock, versionLiteralPattern);
});

test('package and lockfile release versions match', () => {
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
});
