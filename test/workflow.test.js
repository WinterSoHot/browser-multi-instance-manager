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

function containsHereDocOperator(text) {
  return /^\s*(?!#).*<<-?\s*\S+/m.test(text);
}

function containsNewlineSpanningQuotedString(text) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inSingleQuote) {
      if (char === '\n') {
        return true;
      }
      if (char === '\'') {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\n') {
        return true;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === '#') {
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '\'') {
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
    }
  }

  return false;
}

function hasDisallowedShellBodySyntax(text) {
  return containsHereDocOperator(text) || containsNewlineSpanningQuotedString(text);
}

function matchesExactLines(text, lines) {
  if (hasDisallowedShellBodySyntax(text)) {
    return false;
  }

  return lines.every((line) => hasExactLine(text, line));
}

function replaceLineWithDecoy(lines, index, mode) {
  const updated = [...lines];
  const line = lines[index];

  updated[index] = mode === 'inline-comment'
    ? `true # ${line}`
    : `printf '%s\\n' '${line}'`;

  return updated.join('\n');
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

test('workflow contract matchers reject line-level inline-comment and echo-only fakes', async (t) => {
  const lineSets = [
    ['remote-state', remoteStateContractLines],
    ['annotated-tag', annotatedTagContractLines],
  ];
  const modes = ['inline-comment', 'echo-only'];

  for (const [label, lines] of lineSets) {
    for (let index = 0; index < lines.length; index += 1) {
      for (const mode of modes) {
        await t.test(`${label} rejects ${mode} decoy for ${lines[index]}`, () => {
          const fakeBody = replaceLineWithDecoy(lines, index, mode);
          assert.equal(
            matchesExactLines(fakeBody, lines),
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
    ['remote-state', remoteStateContractLines],
    ['annotated-tag', annotatedTagContractLines],
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

  for (const [label, lines] of lineSets) {
    for (const [mode, buildBody] of Object.entries(decoyBodies)) {
      await t.test(`${label} rejects ${mode} decoy`, () => {
        assert.equal(
          matchesExactLines(buildBody(lines), lines),
          false,
          `${label} should reject ${mode} decoys`,
        );
      });
    }
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
