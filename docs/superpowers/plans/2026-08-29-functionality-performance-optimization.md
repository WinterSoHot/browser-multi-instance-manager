# Functionality and Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser-state recovery reliable and the application responsive with many profiles while adding safe profile and browser-path management tools.

**Architecture:** Move reusable behavior into dependency-free helpers under `lib/`, keep privileged filesystem and process operations in `main.js`, expose narrow IPC methods through `preload.js`, and let the renderer consume bulk snapshots and pushed state changes. Preserve the existing store schema while accepting additive fields and validated import documents.

**Tech Stack:** Electron, CommonJS JavaScript, `electron-store`, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-29-functionality-performance-optimization-design.md`

## Global Constraints

- Support macOS and Windows; do not add Linux packaging in this change.
- Add no runtime or development dependency.
- Never permanently delete profile data; use Electron's operating-system trash API.
- Export and import metadata only, never browser profile contents or credentials.
- Keep release workflow behavior unchanged.
- Run `npm test` and `npm run build:mac` before requesting merge approval.

---

### Task 1: Shared Renderer and Profile Helpers

**Files:**
- Modify: `renderer/view-utils.js`
- Modify: `lib/profile-utils.js`
- Test: `test/view-utils.test.js`
- Test: `test/profile-utils.test.js`

**Interfaces:**
- Produces: `filterProfiles(profiles, browserType, query)`, `mapWithConcurrency(items, limit, worker, onProgress)`, `normalizeStatusSnapshot(snapshot)`, `isDuplicateProfileName(profiles, browserType, name, excludedId)`, and import validation helpers.

- [ ] Write failing tests for visible-profile filtering, four-worker concurrency, status normalization, per-browser uniqueness, and validated metadata imports.
- [ ] Run the focused tests and confirm each fails because its helper is missing.
- [ ] Implement the minimal pure helpers and export them.
- [ ] Run the focused tests and the full test suite.

### Task 2: Bulk Process Status and Unknown-State Recovery

**Files:**
- Modify: `lib/browser-process-manager.js`
- Modify: `lib/process-inspector.js`
- Modify: `main.js`
- Modify: `preload.js`
- Test: `test/browser-process-manager.test.js`
- Test: `test/process-inspector.test.js`

**Interfaces:**
- Produces: `BrowserProcessManager.getStatuses(profileIds, options)`, `forget(profileId)`, a status-change subscription, and batched process inspection.
- Consumes: normalized status snapshots from Task 1.

- [ ] Write failing tests for one bulk snapshot, unknown verification, safe record forgetting, and shared process inspection.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement manager APIs, IPC handlers, and the preload subscription with cleanup.
- [ ] Run focused and full tests.

### Task 3: Browser Discovery and Asynchronous Filesystem Operations

**Files:**
- Modify: `lib/browser-paths.js`
- Modify: `main.js`
- Modify: `preload.js`
- Test: `test/browser-paths.test.js`

**Interfaces:**
- Produces: `getBrowserPathOptions(platform, env)`, `resolveInstalledBrowserPath(...)`, and one `get-browser-environment` IPC response containing platform, configured paths, detected defaults, and validation status.

- [ ] Write failing tests for macOS bundles, Windows machine/per-user candidates, and missing custom executables.
- [ ] Run focused tests and verify failure.
- [ ] Implement discovery and settings validation; convert profile IPC filesystem operations to `fs.promises`.
- [ ] Run focused and full tests.

### Task 4: Profile Lifecycle Operations

**Files:**
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `renderer/index.html`
- Modify: `renderer/index.js`
- Test: `test/profile-utils.test.js`

**Interfaces:**
- Produces: clone, JSON export/import, on-demand directory size, and removal with optional trash operations.
- Consumes: import validation and per-browser uniqueness from Task 1.

- [ ] Write failing tests for clone naming, import validation, and metadata-only export shape.
- [ ] Run tests and confirm expected failures.
- [ ] Implement IPC and renderer actions; use `shell.trashItem` only after explicit UI selection.
- [ ] Run focused and full tests.

### Task 5: Responsive Renderer and Bounded Bulk Actions

**Files:**
- Modify: `renderer/index.js`
- Modify: `renderer/styles.css`
- Modify: `renderer/settings.js`
- Modify: `renderer/settings.html`
- Test: `test/view-utils.test.js`

**Interfaces:**
- Consumes: bulk status subscription, `filterProfiles`, `mapWithConcurrency`, and browser environment response.

- [ ] Write failing tests for progress ordering, hidden-item selection, and compact error summaries.
- [ ] Confirm focused tests fail for missing behavior.
- [ ] Replace per-profile polling with pushed/bulk status, pause fallback polling while hidden, debounce search, delegate list events, patch status-only changes, and cap bulk operations at four.
- [ ] Load settings in one request and show detected/path-invalid states.
- [ ] Run focused and full tests.

### Task 6: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Documents all user-visible behavior and verification requirements.

- [ ] Update usage, safety, import/export, process-state, and browser-detection documentation.
- [ ] Run `npm test` and record the exact pass count.
- [ ] Run `npm run build:mac` and confirm exit code 0 and generated DMGs.
- [ ] Review `git diff`, ensure `.claude/settings.local.json` remains untouched, and report results without merging or pushing.
