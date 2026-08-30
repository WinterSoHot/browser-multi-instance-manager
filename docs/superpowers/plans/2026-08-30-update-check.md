# Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cached automatic and explicit manual checks for newer GitHub Releases without downloading or installing software.

**Architecture:** A dependency-injected update checker validates versions and release URLs, shares in-flight requests, and stores only check timestamps and the last safe result. IPC exposes check results; settings and the main window render non-blocking notices.

**Tech Stack:** Electron/Node HTTPS, CommonJS JavaScript, electron-store, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-30-p0-tray-update-refactor-design.md`

## Global Constraints

- Requires the modular foundation plan.
- Automatic checks run at most once per 24 hours and never block window creation.
- Manual checks bypass the time cache but share an in-flight request.
- Accept only this repository's HTTPS GitHub release page.
- Never download, execute, or install an update.
- Cache only validated successful results, bind them to the checking app version, and ignore future timestamps.
- The fixed GitHub client rejects redirects and oversized bodies; failures never suppress retries for 24 hours.

---

### Task 1: Version and Release Validation

**Files:**
- Create: `lib/update-checker.js`
- Create: `test/update-checker.test.js`

**Interfaces:**
- Produces: `parseSemver(version)`, `compareSemver(left, right)`, `validateReleaseUrl(url)`, `validateReleaseResponse(response)`, and `createUpdateChecker(options)`.
- `check({ force })` returns `{ status: 'available', version, releaseUrl }`, `{ status: 'current' }`, `{ status: 'cached', result }`, or `{ status: 'error', code }`.

- [ ] **Step 1: Add failing version and URL tests**

```js
test('accepts only a newer stable semantic version from the exact repository', () => {
  assert.deepEqual(validateReleaseResponse({
    tag_name: 'v1.4.0',
    html_url: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0',
    draft: false,
    prerelease: false,
  }), { version: '1.4.0', releaseUrl: expectedUrl });
});

test('rejects lookalike hosts and repository paths', () => {
  assert.throws(() => validateReleaseUrl(
    'https://github.com.evil.example/WinterSoHot/browser-multi-instance-manager/releases/tag/v9.0.0',
  ));
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/update-checker.test.js`

- [ ] **Step 3: Implement semver and strict URL checks**

Support stable `MAJOR.MINOR.PATCH` versions only, rejecting leading zeroes. Parse with a regular expression and compare numeric components as safe integers. Require protocol `https:`, hostname `github.com`, no credentials/port/query/hash, and an exact pathname `/WinterSoHot/browser-multi-instance-manager/releases/tag/v<version>`. The response tag and URL tag must be identical.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/update-checker.test.js && npm test`

```bash
git add lib/update-checker.js test/update-checker.test.js
git commit -m "新增更新版本与发布地址校验"
```

### Task 2: Cached Single-Flight Network Check

**Files:**
- Modify: `lib/update-checker.js`
- Modify: `test/update-checker.test.js`
- Create: `lib/github-release-client.js`
- Create: `test/github-release-client.test.js`
- Modify: `lib/app-store.js`
- Modify: `test/app-store.test.js`

**Interfaces:**
- Consumes: `currentVersion`, `requestLatestRelease({ signal })`, `now`, `cache`, `timeoutMs`.
- Produces: 24-hour caching, five-second timeout, and one shared in-flight check.
- Persists: `{ checkedAt, checkedVersion, result }`, where `result` is only validated `current` or `available` data.

- [ ] **Step 1: Add failing cache, force, timeout, and single-flight tests**

```js
test('concurrent manual checks share one request', async () => {
  const [first, second] = await Promise.all([
    checker.check({ force: true }),
    checker.check({ force: true }),
  ]);
  assert.equal(requestLatestRelease.calls.length, 1);
  assert.deepEqual(first, second);
});

test('automatic check uses a result newer than less than 24 hours', async () => {
  const result = await checker.check({ force: false });
  assert.equal(result.status, 'cached');
  assert.equal(requestLatestRelease.calls.length, 0);
});
```

- [ ] **Step 2: Implement abortable request orchestration**

Use `AbortController`, a five-second timer, and `finally` to clear both timer and in-flight promise. The fixed HTTPS client requests only GitHub's exact latest-release API endpoint, sends explicit `Accept` and `User-Agent` headers, requires HTTP 200 JSON, rejects redirects, and caps the body at 256 KiB before parsing. Map timeout, HTTP, parse, rate-limit, oversized-body, and validation failures to stable codes without response bodies or local details.

- [ ] **Step 3: Persist minimal cache fields**

Store the minimal cache shape above. Revalidate cached results against `currentVersion`; a different checking version, an invalid/future timestamp, or malformed cached result forces a network check. Do not cache errors or store response headers, IP addresses, tokens, or raw bodies.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/update-checker.test.js test/app-store.test.js && npm test`

```bash
git add lib/update-checker.js lib/app-store.js test/update-checker.test.js test/app-store.test.js
git commit -m "新增限频单飞更新检查"
```

### Task 3: Update IPC and Settings UI

**Files:**
- Modify: `lib/ipc-handlers.js`
- Modify: `preload.js`
- Modify: `renderer/settings.html`
- Modify: `renderer/settings.js`
- Modify: `renderer/index.html`
- Modify: `renderer/index.js`
- Modify: `main.js`
- Modify: `test/ipc-handlers.test.js`

**Interfaces:**
- Produces: `check-for-updates({ force })`, app setting `checkUpdatesOnStartup: boolean`, and `open-release-page(releaseUrl)` after main-process URL revalidation.

- [ ] **Step 1: Add failing IPC validation tests**

```js
test('release page IPC rejects non-GitHub and mismatched repository URLs', async () => {
  const result = await handlers.get('open-release-page')({}, 'https://example.com/release');
  assert.deepEqual(result, { success: false, code: 'INVALID_RELEASE_URL' });
  assert.equal(openExternal.calls.length, 0);
});
```

- [ ] **Step 2: Register narrow APIs and revalidate before opening**

Extend the centralized app-settings schema with `checkUpdatesOnStartup: boolean` (default `true`) without breaking `closeToTray`. The renderer cannot send arbitrary URLs to `shell.openExternal`. `open-release-page` must call the same strict validator used for API responses before opening the HTTPS page, and open failures return a stable result.

- [ ] **Step 3: Add settings and main-page notice**

Show current `app.getVersion()`, a startup-check checkbox, a busy “立即检查更新” button, and statuses for current/available/error. The main page displays one dismissible available-update notice with a “查看下载” action.

- [ ] **Step 4: Start the automatic check after window creation**

When enabled, schedule exactly one check only after the initial window's `did-finish-load`, so the result event cannot beat renderer subscription. Do not await it from `initializationPromise`; deliver only a validated result through a narrow event. Recreated windows must not trigger another network check inside the 24-hour window.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/update-checker.test.js test/ipc-handlers.test.js && node --check renderer/settings.js && node --check renderer/index.js && npm test`

```bash
git add lib/ipc-handlers.js preload.js renderer/settings.html renderer/settings.js renderer/index.html renderer/index.js main.js test/ipc-handlers.test.js
git commit -m "新增更新检查与版本提示界面"
```

### Task 4: Update Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: complete user and contributor guidance for update checks.

- [ ] **Step 1: Document privacy and behavior**

Explain the 24-hour GitHub check, manual override, supported release URL, lack of automatic installation, and non-blocking failures.

- [ ] **Step 2: Run all automated verification**

Run: `npm test && node --check main.js && node --check preload.js && node --check renderer/index.js && node --check renderer/settings.js && git diff --check`

- [ ] **Step 3: Run local packaging and smoke checks**

Run: `npm run build:mac`

Verify both DMGs are produced. Launch the packaged app and verify current-version, available-version, offline, cached, forced-check, and safe release-page flows.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "更新版本检查与发布下载说明"
```

- [ ] **Step 5: Report the merge gate**

Record the exact test count, syntax results, DMG verification, changed files, and remaining Windows Actions requirement. State “可以合并” only when all local checks pass; do not push `main` until the user explicitly approves.
