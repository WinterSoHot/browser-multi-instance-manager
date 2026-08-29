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

function stepBlock(jobName, stepName) {
  const block = jobBlock(jobName);
  const marker = `      - name: ${stepName}\n`;
  const startIndex = block.indexOf(marker);
  assert.notEqual(startIndex, -1, `Missing step: ${jobName} / ${stepName}`);

  const contentStart = startIndex + marker.length;
  const nextStepOffset = block.slice(contentStart).search(/^      - name: /m);
  return nextStepOffset === -1
    ? block.slice(contentStart)
    : block.slice(contentStart, contentStart + nextStepOffset);
}

function runStepBody(jobName, stepName) {
  const block = stepBlock(jobName, stepName);
  const marker = '        run: |\n';
  const startIndex = block.indexOf(marker);
  assert.notEqual(startIndex, -1, `Missing run block: ${jobName} / ${stepName}`);

  return block
    .slice(startIndex + marker.length)
    .replace(/^ {10}/gm, '')
    .trimEnd();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasExactLine(text, line) {
  return new RegExp(`^\\s*${escapeRegExp(line)}\\s*$`, 'm').test(text);
}

function assertHasExactLine(text, line) {
  assert.match(text, new RegExp(`^\\s*${escapeRegExp(line)}\\s*$`, 'm'));
}

function matchesExactLines(text, lines) {
  return lines.every((line) => hasExactLine(text, line));
}

const jobsIndex = workflow.indexOf('jobs:\n');
assert.notEqual(jobsIndex, -1, 'Missing jobs block');
const topLevelBlock = workflow.slice(0, jobsIndex);
const triggerBlock = blockBetween(workflow, 'on:\n', '\njobs:\n');
const prepareBlock = jobBlock('prepare');
const buildMacBlock = jobBlock('build-mac');
const buildWinBlock = jobBlock('build-win');
const releaseBlock = jobBlock('release');
const prepareReleaseStateBody = runStepBody('prepare', 'Determine release state');
const releaseTagStateBody = runStepBody('release', 'Create or verify annotated tag');
const remoteStateContractLines = [
  'RELEASE_STATUS=$?',
  'if [ "$RELEASE_STATUS" -ne 1 ] || ! grep -q "HTTP 404" "$RELEASE_ERROR"; then',
  'TAG_STATUS=$?',
  'if [ "$TAG_STATUS" -ne 2 ]; then',
];
const annotatedTagContractLines = [
  'TAG_TYPE="$(git cat-file -t "$TAG")"',
  'if [ "$TAG_TYPE" != "tag" ]; then',
  'TAG_COMMIT="$(git rev-list -n 1 "$TAG")"',
  'if [ "$TAG_COMMIT" != "$GITHUB_SHA" ]; then',
];

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
  assertHasExactLine(prepareReleaseStateBody, 'if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then');
  assertHasExactLine(prepareReleaseStateBody, 'if [ "$GITHUB_REF" != "refs/heads/main" ]; then');
  assertHasExactLine(prepareReleaseStateBody, 'echo "workflow_dispatch releases must target refs/heads/main" >&2');
  assert.equal(matchesExactLines(prepareReleaseStateBody, remoteStateContractLines), true);
  assertHasExactLine(prepareReleaseStateBody, 'echo "Unable to determine whether remote tag $TAG exists." >&2');
});

test('prepare accepts only a same-commit annotated existing tag', () => {
  assert.equal(matchesExactLines(prepareReleaseStateBody, annotatedTagContractLines), true);
});

test('workflow contract matchers reject inline-comment and echo-only fakes', () => {
  const fakeRemoteState = [
    'echo "RELEASE_STATUS guard starts here"',
    'true # if [ "$RELEASE_STATUS" -ne 1 ] || ! grep -q "HTTP 404" "$RELEASE_ERROR"; then',
    'echo "TAG_STATUS guard starts here"',
    'true # if [ "$TAG_STATUS" -ne 2 ]; then',
    'echo "Unable to determine whether remote tag $TAG exists."',
  ].join('\n');
  const fakeAnnotatedTag = [
    'echo \'TAG_TYPE="$(git cat-file -t "$TAG")"\'',
    'echo \'if [ "$TAG_TYPE" != "tag" ]; then\'',
    'echo \'TAG_COMMIT="$(git rev-list -n 1 "$TAG")"\'',
    'echo \'if [ "$TAG_COMMIT" != "$GITHUB_SHA" ]; then\'',
  ].join('\n');

  assert.equal(matchesExactLines(fakeRemoteState, remoteStateContractLines), false);
  assert.equal(matchesExactLines(fakeAnnotatedTag, annotatedTagContractLines), false);
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
  assert.equal(matchesExactLines(releaseTagStateBody, remoteStateContractLines), true);
  assertHasExactLine(releaseTagStateBody, 'echo "Unable to determine whether remote tag $TAG exists." >&2');
  assert.equal(matchesExactLines(releaseTagStateBody, annotatedTagContractLines), true);
  assert.doesNotMatch(releaseTagStateBody, /^git (?:tag|push).*(?:--force|\s-f\b).*$/m);
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
