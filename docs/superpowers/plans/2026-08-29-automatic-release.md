# Automatic Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tag-first releases with automatic, package-version-driven cross-platform CI that creates an annotated tag and GitHub Release only after both installers build successfully.

**Architecture:** One GitHub Actions workflow handles pull-request tests and serialized `main` pushes. A prepare job derives release state from `package.json`; macOS and Windows jobs always test and conditionally package; a least-privilege release job publishes verified artifacts and supports recovery from a same-commit tag without moving tags.

**Tech Stack:** GitHub Actions YAML, Node.js 20, npm, Electron Builder, GitHub CLI, Node built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-29-automatic-release-design.md`

## Global Constraints

- Read the release version from `package.json`; require matching versions in `package-lock.json`.
- Run tests on `macos-latest` and `windows-latest` for pull requests and `main` pushes.
- Create no new tag until both platform packages build successfully.
- Create annotated `v<version>` tags and never move or reuse a conflicting tag.
- Use `actions/checkout@v5`, `actions/setup-node@v5`, `actions/upload-artifact@v6`, and `actions/download-artifact@v6` while testing the application on Node.js 20.
- Keep default workflow permissions read-only and grant `contents: write` only to the release job.
- Do not stage or modify `.claude/settings.local.json`.

---

### Task 1: Add the workflow contract regression test

**Files:**
- Create: `test/workflow.test.js`

**Interfaces:**
- Consumes: `.github/workflows/build.yml` as UTF-8 text and both package manifests as JSON.
- Produces: a regression contract covering triggers, action majors, version consistency, conditional builds, annotated tagging, and release creation.

- [ ] **Step 1: Write the failing workflow contract test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

test('release workflow validates main and pull requests before publishing', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.doesNotMatch(workflow, /tags:\s*\n/);
  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /actions\/setup-node@v5/);
  assert.match(workflow, /actions\/upload-artifact@v6/);
  assert.match(workflow, /actions\/download-artifact@v6/);
});

test('release workflow publishes only after platform builds', () => {
  assert.match(workflow, /needs:\s*\[prepare, build-mac, build-win\]/);
  assert.match(workflow, /git tag -a/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /contents: write/);
});

test('package and lockfile release versions match', () => {
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
});
```

- [ ] **Step 2: Run the focused test and verify the old workflow fails**

Run: `node --test test/workflow.test.js`

Expected: FAIL because the current workflow lacks `pull_request`, uses the old action majors, and is tag-triggered.

- [ ] **Step 3: Commit the failing regression test**

```bash
git add test/workflow.test.js
git commit -m "测试：约束自动发布工作流"
```

### Task 2: Implement automatic cross-platform release orchestration

**Files:**
- Modify: `.github/workflows/build.yml`
- Test: `test/workflow.test.js`

**Interfaces:**
- Consumes: `package.json.version`, `package-lock.json.version`, `github.event_name`, `github.sha`, repository tags, and GitHub Releases.
- Produces: prepare outputs `tag`, `should_release`, and `create_tag`; artifacts named `dmg` and `exe`; annotated tag and GitHub Release.

- [ ] **Step 1: Replace the workflow triggers and permissions**

Configure `pull_request` and `push.branches: [main]`, plus `workflow_dispatch` for retrying the selected `main` commit without inputs. Add workflow-level `concurrency` with `cancel-in-progress: false` and default `contents: read`.

- [ ] **Step 2: Add a prepare job with strict version-state checks**

Checkout with full history, read both manifest versions in a Node step, reject non-matching or non-SemVer values, and write `tag=v<version>` to `$GITHUB_OUTPUT`. For pull requests, emit `should_release=false`. For `main`, use `git ls-remote` and `gh release view` to distinguish: published release (skip), absent tag (build and create), same-SHA tag without release (build and resume), or conflicting unpublished tag (fail).

- [ ] **Step 3: Convert macOS and Windows jobs to test-first conditional builders**

Make both jobs depend on `prepare`, use checkout/setup-node v5, run `npm ci` and `npm test` unconditionally, then run `npm run build:mac` or `npm run build:win` and upload with v6 only when `should_release == 'true'`.

- [ ] **Step 4: Add the least-privilege release job**

Make the job depend on `[prepare, build-mac, build-win]`, condition it on `should_release == 'true'`, grant only it `contents: write`, download artifacts with v6, recheck the remote tag, create and push `git tag -a <tag> <github.sha> -m <tag>` only when absent, verify an existing tag resolves to the same commit, then run:

```bash
gh release create "$TAG" artifacts/*.dmg artifacts/*.exe \
  --verify-tag \
  --target "$GITHUB_SHA" \
  --title "$TAG" \
  --generate-notes
```

- [ ] **Step 5: Run the focused test**

Run: `node --test test/workflow.test.js`

Expected: PASS with three tests.

- [ ] **Step 6: Validate YAML parsing**

Run: `ruby -e "require 'yaml'; YAML.parse_file('.github/workflows/build.yml'); puts 'YAML OK'"`

Expected: `YAML OK`.

- [ ] **Step 7: Commit the workflow implementation**

```bash
git add .github/workflows/build.yml
git commit -m "优化：构建成功后自动发布"
```

### Task 3: Document the release contract and verify the repository

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-08-29-automatic-release-design.md`
- Modify: `docs/superpowers/plans/2026-08-29-automatic-release.md`
- Test: all files under `test/`

**Interfaces:**
- Consumes: the implemented workflow behavior.
- Produces: contributor instructions that require local validation and explain automatic version-based publishing.

- [x] **Step 1: Rewrite the Release Process section**

State that contributors update both manifest versions, run `npm test` and the platform-appropriate package command, obtain explicit approval, and push `main`. Explain that Actions tests both platforms, skips publishing for an existing released version, and otherwise builds installers before creating the annotated tag and Release. Prohibit manually creating a release tag in advance or moving/reusing any tag.

- [x] **Step 2: Run the complete unit suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [x] **Step 3: Build the local macOS packages**

Run: `npm run build:mac`

Expected: exit code 0 and x64/arm64 DMG files under ignored `dist/`.

- [x] **Step 4: Review only intended changes**

Run: `git diff --check && git status --short && git diff -- . ':!.claude/settings.local.json'`

Expected: no whitespace errors; `.claude/settings.local.json` remains unstaged and unchanged by this work.

- [x] **Step 5: Commit documentation and plan records**

```bash
git add AGENTS.md docs/superpowers/specs/2026-08-29-automatic-release-design.md docs/superpowers/plans/2026-08-29-automatic-release.md
git commit -m "文档：记录自动发布流程"
```
