# Windows CI Repair and v1.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tray asset test deterministic on every runner and prepare synchronized `1.4.0` manifests for release verification.

**Architecture:** Keep production tray selection and the workflow unchanged. Make the macOS-specific test declare its simulated platform, preserve the existing three-platform matrix, then use npm's version command to update both manifests atomically.

**Tech Stack:** CommonJS JavaScript, Node.js built-in test runner, npm, Electron Builder, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-31-windows-ci-v1.4.0-design.md`

## Global Constraints

- Production must keep `trayTemplate.png` on macOS and `trayIcon.png` on Windows/Linux.
- Do not modify `.github/workflows/build.yml` for this failure.
- `package.json` and `package-lock.json` must both contain exactly `1.4.0`.
- Do not create, move, or push `v1.4.0` before the exact-commit release gate passes.
- Do not push `main` until full tests and local macOS packaging pass and the user explicitly approves.

---

### Task 1: Make the Tray Test Platform-Deterministic

**Files:**
- Modify: `test/main-tray-behavior.test.js:262-266`
- Test: `test/main-tray-behavior.test.js`

**Interfaces:**
- Consumes: `loadMain({ platform })`, which temporarily overrides `process.platform` for the main-process harness.
- Produces: a macOS-specific template assertion that is independent of the host runner.

- [ ] **Step 1: Install the locked dependencies in the isolated worktree**

Run:

```bash
npm ci
```

Expected: installation exits `0` without changing either manifest.

- [ ] **Step 2: Reproduce the Windows failure locally**

Run:

```bash
node -e "Object.defineProperty(process, 'platform', { value: 'win32' }); require('./test/main-tray-behavior.test.js')"
```

Expected: exactly one failure, `main selects the dedicated tray template asset`, because the actual path ends in `trayIcon.png` while the assertion expects `trayTemplate.png`.

- [ ] **Step 3: Make the test declare macOS explicitly**

Replace the ambient-platform harness creation with:

```js
test('main selects the dedicated tray template asset', async () => {
  const harness = await loadMain({ platform: 'darwin' });

  assert.match(harness.iconPaths[0], /trayTemplate\.png$/u);
});
```

Do not change the adjacent macOS/Windows/Linux matrix test or production code.

- [ ] **Step 4: Verify the Windows-emulated and focused tests**

Run:

```bash
node -e "Object.defineProperty(process, 'platform', { value: 'win32' }); require('./test/main-tray-behavior.test.js')"
node --test test/main-tray-behavior.test.js test/tray-icon.test.js test/tray-manager.test.js
```

Expected: all commands exit `0`; the emulated run reports 16/16 passing.

- [ ] **Step 5: Run the full suite and commit**

Run:

```bash
npm test
git diff --check
```

Expected: 351/351 tests pass and the diff check is clean.

```bash
git add test/main-tray-behavior.test.js
git commit -m "修复 Windows 托盘资源测试"
```

### Task 2: Upgrade Both Manifests to v1.4.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/workflow-contract.test.js`

**Interfaces:**
- Consumes: `npm version <version> --no-git-tag-version` and the workflow contract requiring manifest equality.
- Produces: synchronized application/package version `1.4.0` without creating a Git tag.

- [ ] **Step 1: Prove the target version is unused**

Run:

```bash
git tag --list v1.4.0
git ls-remote --tags origin refs/tags/v1.4.0 refs/tags/v1.4.0^{}
gh release view v1.4.0
```

Expected: local and remote tag queries return no tag; `gh release view` reports that the release does not exist. If any exact target exists, stop and increment to the next unused version instead of overwriting it.

- [ ] **Step 2: Update both manifests without creating a tag**

Run:

```bash
npm version 1.4.0 --no-git-tag-version
```

Expected: npm prints `v1.4.0`; only `package.json` and `package-lock.json` change in this task.

- [ ] **Step 3: Verify manifest equality and release contracts**

Run:

```bash
node -e "const pkg = require('./package.json'); const lock = require('./package-lock.json'); if (pkg.version !== '1.4.0' || lock.version !== '1.4.0' || lock.packages[''].version !== '1.4.0') process.exit(1)"
node --test test/workflow-contract.test.js test/package-scripts.test.js
npm test
git diff --check
```

Expected: all commands exit `0` and the full suite remains 351/351.

- [ ] **Step 4: Commit the version upgrade**

```bash
git add package.json package-lock.json
git commit -m "更新版本至 1.4.0"
```

### Task 3: Run the Local Release Gate

**Files:**
- Verify: `dist/Browser Multi-Instance Manager-1.4.0.dmg`
- Verify: `dist/Browser Multi-Instance Manager-1.4.0-arm64.dmg`
- Verify: packaged `app.asar` for x64 and arm64

**Interfaces:**
- Consumes: committed `1.4.0` manifests and the existing `build.files` package whitelist.
- Produces: evidence for the explicit user approval gate before merging or pushing `main`.

- [ ] **Step 1: Run automated verification from the committed HEAD**

Run:

```bash
npm test
node --check main.js
node --check preload.js
node --check renderer/index.js
node --check renderer/settings.js
git diff --check
git status --short
```

Expected: 351/351 tests pass, checks exit `0`, and the tracked working tree is clean.

- [ ] **Step 2: Build both macOS architectures**

Run:

```bash
npm run build:mac
```

Expected: exit `0`; Electron Builder produces the x64 and arm64 `1.4.0` DMGs. Missing local signing identity is an expected warning, not a build failure.

- [ ] **Step 3: Validate DMGs and packaged runtime files**

Run:

```bash
hdiutil verify "dist/Browser Multi-Instance Manager-1.4.0.dmg"
hdiutil verify "dist/Browser Multi-Instance Manager-1.4.0-arm64.dmg"
node_modules/.bin/asar list "dist/mac/Browser Multi-Instance Manager.app/Contents/Resources/app.asar"
node_modules/.bin/asar list "dist/mac-arm64/Browser Multi-Instance Manager.app/Contents/Resources/app.asar"
```

Expected: both images are valid; each asar contains `main.js`, `preload.js`, `lib/`, `renderer/`, `package.json`, and all three runtime tray PNGs.

- [ ] **Step 4: Start the host-compatible packaged app**

Run the x64 packaged executable with a new isolated `--user-data-dir`, confirm its main and renderer processes remain alive, then terminate only that launched process tree.

Expected: the packaged application initializes its isolated `browser-profiles.json` without startup errors.

- [ ] **Step 5: Report the merge gate**

Record the exact commit, test count, DMG validation, package contents, and host-platform smoke result. State `可以合并` only when every local check above passes. Wait for explicit approval before merging/pushing `main`; after push, require both GitHub Actions platform jobs to pass before creating annotated `v1.4.0` or publishing a Release.
