const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowSource = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
const workflow = workflowSource.replace(/^[ \t]*#.*(?:\r?\n|$)/gm, '');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

function blockBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing block start: ${start}`);

  const contentStart = startIndex + start.length;
  const endIndex = text.indexOf(end, contentStart);
  assert.notEqual(endIndex, -1, `Missing block end: ${end}`);

  return text.slice(contentStart, endIndex);
}

function jobBlock(name) {
  const marker = `  ${name}:\n`;
  const startIndex = workflow.indexOf(marker);
  assert.notEqual(startIndex, -1, `Missing job: ${name}`);

  const contentStart = startIndex + marker.length;
  const nextJobOffset = workflow.slice(contentStart).search(/^  [a-z][a-z0-9-]*:\n/m);
  return nextJobOffset === -1
    ? workflow.slice(contentStart)
    : workflow.slice(contentStart, contentStart + nextJobOffset);
}

const jobsIndex = workflow.indexOf('jobs:\n');
assert.notEqual(jobsIndex, -1, 'Missing jobs block');
const topLevelBlock = workflow.slice(0, jobsIndex);
const triggerBlock = blockBetween(workflow, 'on:\n', '\njobs:\n');
const prepareBlock = jobBlock('prepare');
const buildMacBlock = jobBlock('build-mac');
const buildWinBlock = jobBlock('build-win');
const releaseBlock = jobBlock('release');

test('release workflow triggers every main push without run-canceling concurrency', () => {
  assert.match(triggerBlock, /pull_request:/);
  assert.match(triggerBlock, /push:\n\s*branches:\n\s*-\s*main/);
  assert.match(triggerBlock, /workflow_dispatch:/);
  assert.doesNotMatch(triggerBlock, /\btags:\s*/);
  assert.doesNotMatch(workflow, /^\s*concurrency:/m);
});

test('prepare validates matching manifest versions and derives the tag dynamically', () => {
  assert.match(prepareBlock, /packageJson\.version/);
  assert.match(prepareBlock, /packageLock\.version/);
  assert.match(prepareBlock, /packageLock\.packages\[['"]['"]\]\.version/);
  assert.match(prepareBlock, /version\s*!==\s*packageLock\.version/);
  assert.match(prepareBlock, /semver\.test\(version\)/);
  assert.match(prepareBlock, /`tag=v\$\{version\}\\n`/);
  assert.doesNotMatch(prepareBlock, new RegExp(`tag=v${packageJson.version}`));
});

test('prepare refuses non-main dispatches and fails closed on remote lookup errors', () => {
  assert.match(prepareBlock, /GITHUB_EVENT_NAME[^\n]*pull_request/);
  assert.match(prepareBlock, /GITHUB_REF[^\n]*refs\/heads\/main/);
  assert.match(prepareBlock, /workflow_dispatch releases must target refs\/heads\/main/);
  assert.match(prepareBlock, /RELEASE_STATUS[^\n]*-ne 1/);
  assert.match(prepareBlock, /grep -q ["']HTTP 404["']/);
  assert.match(prepareBlock, /TAG_STATUS[^\n]*-ne 2/);
  assert.match(prepareBlock, /Unable to determine whether remote tag/);
});

test('prepare accepts only a same-commit annotated existing tag', () => {
  assert.match(prepareBlock, /git cat-file -t ["']\$TAG["']/);
  assert.match(prepareBlock, /TAG_TYPE[^\n]*!= ["']tag["']/);
  assert.match(prepareBlock, /git rev-list -n 1 ["']\$TAG["']/);
  assert.match(prepareBlock, /TAG_COMMIT[^\n]*!= ["']\$GITHUB_SHA["']/);
});

test('platform jobs always test and conditionally package and upload', () => {
  const builders = [
    [buildMacBlock, 'macos-latest', 'npm run build:mac', 'dmg'],
    [buildWinBlock, 'windows-latest', 'npm run build:win', 'exe'],
  ];

  for (const [block, runner, packageCommand, artifactName] of builders) {
    const escapedPackageCommand = packageCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    assert.match(block, new RegExp(`runs-on:\\s*${runner}`));
    assert.match(block, /node-version:\s*'20'/);
    assert.match(block, /run:\s*npm ci/);
    assert.match(block, /run:\s*npm test/);
    assert.match(block, new RegExp(`- name: [^\\n]+\\n\\s*if: needs\\.prepare\\.outputs\\.should_release == 'true'\\n\\s*run: ${escapedPackageCommand}`, 'm'));
    assert.match(block, new RegExp(`- name: [^\\n]+\\n\\s*if: needs\\.prepare\\.outputs\\.should_release == 'true'\\n\\s*uses: actions\/upload-artifact@v6\\n\\s*with:\\n\\s*name: ${artifactName}`, 'm'));
    assert.match(block, /actions\/checkout@v5/);
    assert.match(block, /actions\/setup-node@v5/);
  }
});

test('release waits for prepare and both builders before publishing artifacts', () => {
  assert.match(releaseBlock, /needs:\s*\[prepare, build-mac, build-win\]/);
  assert.match(releaseBlock, /if: needs\.prepare\.outputs\.should_release == 'true'/);
  assert.match(releaseBlock, /VALIDATED_TAG:\s*\$\{\{ needs\.prepare\.outputs\.tag \}\}/);
  assert.match(releaseBlock, /actions\/download-artifact@v6/);
  assert.match(releaseBlock, /git tag -a ["']\$TAG["'] ["']\$GITHUB_SHA["']/);
  assert.match(releaseBlock, /gh release create ["']\$TAG["'] artifacts\/\*\.dmg artifacts\/\*\.exe/);
});

test('release rechecks remote state and accepts only an annotated existing tag', () => {
  assert.match(releaseBlock, /RELEASE_STATUS[^\n]*-ne 1/);
  assert.match(releaseBlock, /grep -q ["']HTTP 404["']/);
  assert.match(releaseBlock, /TAG_STATUS[^\n]*-ne 2/);
  assert.match(releaseBlock, /Unable to determine whether remote tag/);
  assert.match(releaseBlock, /git cat-file -t ["']\$TAG["']/);
  assert.match(releaseBlock, /TAG_TYPE[^\n]*!= ["']tag["']/);
  assert.match(releaseBlock, /git rev-list -n 1 ["']\$TAG["']/);
  assert.match(releaseBlock, /TAG_COMMIT[^\n]*!= ["']\$GITHUB_SHA["']/);
  assert.doesNotMatch(releaseBlock, /git (?:tag|push)[^\n]*(?:--force|\s-f\b)/);
});

test('release workflow keeps permissions scoped to each job', () => {
  assert.doesNotMatch(topLevelBlock, /^permissions:/m);
  assert.match(prepareBlock, /permissions:\n\s*contents:\s*read\n\s*outputs:/);
  assert.match(buildMacBlock, /permissions:\n\s*contents:\s*read\n\s*steps:/);
  assert.match(buildWinBlock, /permissions:\n\s*contents:\s*read\n\s*steps:/);
  assert.match(releaseBlock, /permissions:\n\s*contents:\s*write\n\s*steps:/);
  assert.doesNotMatch(workflow, /actions:\s*write/);
});

test('package and lockfile release versions match', () => {
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
});
