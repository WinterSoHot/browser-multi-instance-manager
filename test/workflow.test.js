const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

function normalizeWorkflowSource(source) {
  return source.replace(/\r\n?/g, '\n');
}

const rawWorkflowSource = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');

function blockBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing block start: ${start}`);

  const contentStart = startIndex + start.length;
  const endIndex = text.indexOf(end, contentStart);
  assert.notEqual(endIndex, -1, `Missing block end: ${end}`);

  return text.slice(contentStart, endIndex);
}

function jobBlockFromText(text, name) {
  const marker = `  ${name}:\n`;
  const startIndex = text.indexOf(marker);
  assert.notEqual(startIndex, -1, `Missing job: ${name}`);

  const contentStart = startIndex + marker.length;
  const nextJobOffset = text.slice(contentStart).search(/^  [a-z][a-z0-9-]*:\n/m);
  return nextJobOffset === -1
    ? text.slice(contentStart)
    : text.slice(contentStart, contentStart + nextJobOffset);
}

function jobBlock(name) {
  return jobBlockFromText(workflow, name);
}

function stepBlockFromJobBlock(block, jobName, stepName) {
  const marker = `      - name: ${stepName}\n`;
  const startIndex = block.indexOf(marker);
  assert.notEqual(startIndex, -1, `Missing step: ${jobName} / ${stepName}`);

  const contentStart = startIndex + marker.length;
  const nextStepOffset = block.slice(contentStart).search(/^      - /m);
  return nextStepOffset === -1
    ? block.slice(contentStart)
    : block.slice(contentStart, contentStart + nextStepOffset);
}

function stepBlock(jobName, stepName) {
  return stepBlockFromJobBlock(jobBlock(jobName), jobName, stepName);
}

function runStepBodyFromStepBlock(block, jobName, stepName) {
  const runMatch = /^ {8}run: \|\n/m.exec(block);
  assert.notEqual(runMatch, null, `Missing run block: ${jobName} / ${stepName}`);

  const runIndent = 8;
  const remainder = block.slice(runMatch.index + runMatch[0].length);
  const lines = remainder.split('\n');
  const bodyLines = [];

  for (const line of lines) {
    if (line.trim() === '') {
      bodyLines.push('');
      continue;
    }

    const indent = line.match(/^ */)[0].length;
    if (indent <= runIndent) {
      break;
    }

    bodyLines.push(line);
  }

  const nonBlankIndents = bodyLines
    .filter((line) => line.trim() !== '')
    .map((line) => line.match(/^ */)[0].length);
  const commonIndent = nonBlankIndents.length === 0 ? 0 : Math.min(...nonBlankIndents);

  return bodyLines
    .map((line) => {
      if (line.trim() === '') {
        return '';
      }

      return line.slice(commonIndent);
    })
    .join('\n')
    .trimEnd();
}

function runStepBody(jobName, stepName) {
  return runStepBodyFromStepBlock(stepBlock(jobName, stepName), jobName, stepName);
}

function runStepBodyFromText(text, jobName, stepName) {
  return runStepBodyFromStepBlock(
    stepBlockFromJobBlock(jobBlockFromText(text, jobName), jobName, stepName),
    jobName,
    stepName,
  );
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function matchesExactLines(text, lines) {
  return lines.every((line) => hasExactLine(text, line));
}

function matchesAuditedScript(text, lines, expectedSha256) {
  return matchesExactLines(text, lines) && sha256(text) === expectedSha256;
}

function replaceLineWithDecoy(lines, index, mode) {
  const updated = [...lines];
  const line = lines[index];

  updated[index] = mode === 'inline-comment'
    ? `true # ${line}`
    : `printf '%s\\n' '${line}'`;

  return updated.join('\n');
}

// Any change to these audited shell bodies requires re-auditing the exact extracted
// script and updating the pinned SHA-256 below.
const PREPARE_RELEASE_STATE_AUDITED_SHA256 = '7ec1bcf8c55356aaca99c310e7b3702c2be18f63cee2abea97663c37ffaf8720';
const RELEASE_TAG_STATE_AUDITED_SHA256 = 'ac728920a3b2f2e90e2ead0f89e44fc84b9e3acf13edba9a7f15998bde5e41b8';
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

function parseWorkflowSource(source) {
  const workflowSource = normalizeWorkflowSource(source);
  const workflow = workflowSource.replace(/^[ \t]*#.*(?:\n|$)/gm, '');
  const jobsIndex = workflow.indexOf('jobs:\n');
  assert.notEqual(jobsIndex, -1, 'Missing jobs block');

  const topLevelBlock = workflow.slice(0, jobsIndex);
  const triggerBlock = blockBetween(workflow, 'on:\n', '\njobs:\n');
  const prepareBlock = jobBlockFromText(workflow, 'prepare');
  const buildMacBlock = jobBlockFromText(workflow, 'build-mac');
  const buildWinBlock = jobBlockFromText(workflow, 'build-win');
  const releaseBlock = jobBlockFromText(workflow, 'release');
  const prepareReleaseStateBody = runStepBodyFromText(workflow, 'prepare', 'Determine release state');
  const releaseTagStateBody = runStepBodyFromText(workflow, 'release', 'Create or verify annotated tag');

  return {
    workflowSource,
    workflow,
    topLevelBlock,
    triggerBlock,
    prepareBlock,
    buildMacBlock,
    buildWinBlock,
    releaseBlock,
    prepareReleaseStateBody,
    releaseTagStateBody,
  };
}

const parsedWorkflow = parseWorkflowSource(rawWorkflowSource);
const {
  workflowSource,
  workflow,
  topLevelBlock,
  triggerBlock,
  prepareBlock,
  buildMacBlock,
  buildWinBlock,
  releaseBlock,
  prepareReleaseStateBody,
  releaseTagStateBody,
} = parsedWorkflow;

test('release workflow triggers every main push without run-canceling concurrency', () => {
  assert.match(triggerBlock, /pull_request:/);
  assert.match(triggerBlock, /push:\n\s*branches:\n\s*-\s*main/);
  assert.match(triggerBlock, /workflow_dispatch:/);
  assert.doesNotMatch(triggerBlock, /\btags:\s*/);
  assert.doesNotMatch(workflow, /^\s*concurrency:/m);
});

test('workflow parsing canonicalizes CRLF copies through the unified parser entry point', () => {
  const crlfWorkflow = rawWorkflowSource.replace(/\r?\n/g, '\r\n');
  const parsed = parseWorkflowSource(crlfWorkflow);

  assert.equal(parsed.workflowSource.includes('\r'), false);
  assert.match(parsed.triggerBlock, /workflow_dispatch:/);
  assert.match(parsed.prepareBlock, /permissions:\n\s*contents:\s*read/);
  assert.equal(parsed.prepareReleaseStateBody, prepareReleaseStateBody);
  assert.equal(parsed.releaseTagStateBody, releaseTagStateBody);
  assert.equal(sha256(parsed.prepareReleaseStateBody), PREPARE_RELEASE_STATE_AUDITED_SHA256);
  assert.equal(sha256(parsed.releaseTagStateBody), RELEASE_TAG_STATE_AUDITED_SHA256);
});

test('workflow parsing canonicalizes lone-CR copies through the unified parser entry point', () => {
  const loneCrWorkflow = rawWorkflowSource.replace(/\r?\n/g, '\r');
  const parsed = parseWorkflowSource(loneCrWorkflow);

  assert.equal(parsed.workflowSource.includes('\r'), false);
  assert.match(parsed.triggerBlock, /workflow_dispatch:/);
  assert.match(parsed.releaseBlock, /needs:\s*\[prepare, build-mac, build-win\]/);
  assert.equal(parsed.prepareReleaseStateBody, prepareReleaseStateBody);
  assert.equal(parsed.releaseTagStateBody, releaseTagStateBody);
  assert.equal(sha256(parsed.prepareReleaseStateBody), PREPARE_RELEASE_STATE_AUDITED_SHA256);
  assert.equal(sha256(parsed.releaseTagStateBody), RELEASE_TAG_STATE_AUDITED_SHA256);
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
  assert.equal(sha256(prepareReleaseStateBody), PREPARE_RELEASE_STATE_AUDITED_SHA256);
  assertHasExactLine(prepareReleaseStateBody, 'echo "Unable to determine whether remote tag $TAG exists." >&2');
});

test('prepare accepts only a same-commit annotated existing tag', () => {
  assert.equal(matchesExactLines(prepareReleaseStateBody, annotatedTagContractLines), true);
  assert.equal(matchesAuditedScript(
    prepareReleaseStateBody,
    [...remoteStateContractLines, ...annotatedTagContractLines],
    PREPARE_RELEASE_STATE_AUDITED_SHA256,
  ), true);
});

test('workflow step extraction excludes following unnamed step decoys', () => {
  const syntheticWorkflow = [
    'jobs:',
    '  prepare:',
    '    steps:',
    '      - name: Determine release state',
    '        shell: bash',
    '        run: |',
    '          set -euo pipefail',
    '',
    '      - run: |',
    '          RELEASE_STATUS=$?',
    '          if [ "$RELEASE_STATUS" -ne 1 ] || ! grep -q "HTTP 404" "$RELEASE_ERROR"; then',
    '          TAG_STATUS=$?',
    '          if [ "$TAG_STATUS" -ne 2 ]; then',
  ].join('\n');

  const extracted = runStepBodyFromText(syntheticWorkflow, 'prepare', 'Determine release state');
  assert.equal(matchesExactLines(extracted, remoteStateContractLines), false);
  assert.equal(extracted.trim(), 'set -euo pipefail');
});

test('runStepBodyFromStepBlock stops at same-step dedented YAML fields', () => {
  const stepBlockText = [
    '        shell: bash',
    '        run: |',
    '          set -euo pipefail',
    '          RELEASE_STATUS=$?',
    '        env:',
    '          FAKE_COMMAND: if [ "$TAG_STATUS" -ne 2 ]; then',
  ].join('\n');

  const extracted = runStepBodyFromStepBlock(stepBlockText, 'prepare', 'Determine release state');
  assert.equal(extracted, ['set -euo pipefail', 'RELEASE_STATUS=$?'].join('\n'));
  assert.doesNotMatch(extracted, /TAG_STATUS/);
});

test('workflow contract matchers reject line-level inline-comment and echo-only fakes', async (t) => {
  const lineSets = [
    ['remote-state', remoteStateContractLines, PREPARE_RELEASE_STATE_AUDITED_SHA256],
    ['annotated-tag', annotatedTagContractLines, RELEASE_TAG_STATE_AUDITED_SHA256],
  ];
  const modes = ['inline-comment', 'echo-only'];

  for (const [label, lines, expectedSha256] of lineSets) {
    for (let index = 0; index < lines.length; index += 1) {
      for (const mode of modes) {
        await t.test(`${label} rejects ${mode} decoy for ${lines[index]}`, () => {
          const fakeBody = replaceLineWithDecoy(lines, index, mode);
          assert.notEqual(sha256(fakeBody), expectedSha256, `${label} ${mode} decoy should change the audited script for ${lines[index]}`);
          assert.equal(
            matchesAuditedScript(fakeBody, lines, expectedSha256),
            false,
            `${label} should reject ${mode} decoy for ${lines[index]}`,
          );
        });
      }
    }
  }
});

test('workflow contract matchers reject heredoc and multiline quoted decoys', async (t) => {
  const lineSets = [
    ['remote-state', remoteStateContractLines, PREPARE_RELEASE_STATE_AUDITED_SHA256],
    ['annotated-tag', annotatedTagContractLines, RELEASE_TAG_STATE_AUDITED_SHA256],
  ];
  const decoyBodies = {
    heredoc: (lines) => [
      "cat <<'EOF'",
      ...lines,
      'EOF',
    ].join('\n'),
    'multiline-quoted': (lines) => [
      'printf "%s\\n" "',
      ...lines,
      '"',
    ].join('\n'),
  };

  for (const [label, lines, expectedSha256] of lineSets) {
    for (const [mode, buildBody] of Object.entries(decoyBodies)) {
      await t.test(`${label} rejects ${mode} decoy`, () => {
        const fakeBody = buildBody(lines);
        assert.notEqual(sha256(fakeBody), expectedSha256, `${label} ${mode} decoy should change the audited script`);
        assert.equal(
          matchesAuditedScript(fakeBody, lines, expectedSha256),
          false,
          `${label} should reject ${mode} decoys`,
        );
      });
    }
  }
});

test('workflow contract matchers reject foo#bar multiline-quote bypass decoys', async (t) => {
  const lineSets = [
    ['remote-state', remoteStateContractLines, PREPARE_RELEASE_STATE_AUDITED_SHA256],
    ['annotated-tag', annotatedTagContractLines, RELEASE_TAG_STATE_AUDITED_SHA256],
  ];

  for (const [label, lines, expectedSha256] of lineSets) {
    await t.test(`${label} rejects foo#bar multiline-quote bypass`, () => {
      const fakeBody = [
        'printf foo#bar "',
        ...lines,
        '"',
      ].join('\n');

      assert.notEqual(sha256(fakeBody), expectedSha256, `${label} foo#bar bypass should change the audited script`);
      assert.equal(
        matchesAuditedScript(fakeBody, lines, expectedSha256),
        false,
        `${label} should reject foo#bar multiline-quote bypass`,
      );
    });
  }
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
  assert.equal(matchesAuditedScript(
    releaseTagStateBody,
    [...remoteStateContractLines, ...annotatedTagContractLines],
    RELEASE_TAG_STATE_AUDITED_SHA256,
  ), true);
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
