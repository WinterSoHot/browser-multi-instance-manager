# System Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the manager available from a safe system tray menu with live status, favorite launches, and explicit non-destructive exit behavior.

**Architecture:** Isolate Electron Tray/Menu calls behind an injected manager and place close-versus-quit decisions in a pure lifecycle controller. The tray consumes profile/workspace services and process snapshots without owning persistence or termination.

**Tech Stack:** Electron Tray/Menu/nativeImage, CommonJS JavaScript, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-30-p0-tray-update-refactor-design.md`

## Global Constraints

- Requires the modular foundation and workspace/favorite tasks.
- Closing to tray is enabled by default and configurable.
- Exiting the manager never terminates browser processes.
- Running and unknown states both require an exit warning.
- Tray launches preserve the four-operation concurrency limit.

---

### Task 1: Close and Quit Lifecycle Controller

**Files:**
- Create: `lib/app-lifecycle.js`
- Create: `test/app-lifecycle.test.js`
- Modify: `lib/window-lifecycle.js`

**Interfaces:**
- Produces: `createAppLifecycle({ getCloseToTray, getActiveStatusCount, confirmExit, hideWindow, destroyTray, quitApp })` with `handleWindowClose(event)`, `requestQuit()`, and `isQuitting()`.

- [ ] **Step 1: Add failing lifecycle tests**

```js
test('window close hides when close-to-tray is enabled', async () => {
  const event = createCancelableEvent();
  await lifecycle.handleWindowClose(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(hideCalls, 1);
});

test('cancelled exit leaves tray and browsers untouched', async () => {
  confirmExit.result = false;
  assert.equal(await lifecycle.requestQuit(), false);
  assert.equal(destroyTray.calls.length, 0);
  assert.equal(quitApp.calls.length, 0);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/app-lifecycle.test.js`

- [ ] **Step 3: Implement explicit lifecycle state**

`requestQuit` obtains one status snapshot. When running or unknown count is positive, call `confirmExit(counts)`; confirmation only permits manager exit and never calls a browser-close API. Set `isQuitting` immediately before destroying the tray and calling `quitApp`.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/app-lifecycle.test.js test/window-lifecycle.test.js && npm test`

```bash
git add lib/app-lifecycle.js lib/window-lifecycle.js test/app-lifecycle.test.js test/window-lifecycle.test.js
git commit -m "新增托盘关闭与退出生命周期"
```

### Task 2: Tray Manager

**Files:**
- Create: `lib/tray-manager.js`
- Create: `test/tray-manager.test.js`
- Modify: `main.js`
- Modify: `build/icons/icon.png` only if the existing icon is unreadable at tray size

**Interfaces:**
- Produces: `createTrayManager({ Tray, Menu, iconPath, showWindow, requestQuit, listFavoriteProfiles, launchProfiles, getStatuses })` with `create()`, `refresh()`, and `destroy()`.

- [ ] **Step 1: Add failing menu-model tests**

```js
test('menu shows active count and groups favorite launches by workspace', async () => {
  await tray.refresh();
  assert.match(menuTemplate[0].label, /正在运行 2/);
  assert.equal(findMenuItem(menuTemplate, 'Work').submenu[0].label, 'Account A');
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/tray-manager.test.js`

- [ ] **Step 3: Implement bounded menu construction**

Show at most 20 favorite profiles directly; place remaining items behind the main-window action. Disable launch entries already running or unknown. Double-clicking the tray opens the existing window via `ensureMainWindow()`.

- [ ] **Step 4: Refresh on state and metadata changes**

Debounce refreshes from process-state notifications and workspace/profile mutations. Do not poll separately from the existing process status mechanism.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/tray-manager.test.js test/browser-process-manager.test.js && npm test`

```bash
git add lib/tray-manager.js test/tray-manager.test.js main.js build/icons/icon.png
git commit -m "新增系统托盘与收藏启动菜单"
```

### Task 3: Tray Settings and Platform Integration

**Files:**
- Modify: `lib/app-store.js`
- Modify: `lib/ipc-handlers.js`
- Modify: `preload.js`
- Modify: `renderer/settings.html`
- Modify: `renderer/settings.js`
- Modify: `main.js`
- Modify: `test/app-store.test.js`
- Modify: `test/ipc-handlers.test.js`

**Interfaces:**
- Produces: app setting `closeToTray: boolean`, default `true`; IPC `get-app-settings` and `set-app-settings` with a strict allowlist.

- [ ] **Step 1: Add failing settings validation tests**

```js
test('app settings accept booleans and reject unknown keys', () => {
  assert.deepEqual(validateAppSettings({ closeToTray: false }), { closeToTray: false });
  assert.throws(() => validateAppSettings({ closeToTray: 'no' }));
  assert.throws(() => validateAppSettings({ arbitrary: true }));
});
```

- [ ] **Step 2: Implement storage, IPC, and settings checkbox**

Save `closeToTray` through the main-process store, not localStorage. Update lifecycle behavior immediately after save without restarting the application.

- [ ] **Step 3: Verify platform behavior**

Run: `npm test && node --check main.js && node --check renderer/settings.js`

Manual macOS check: close hides, dock activation restores, tray open restores, cancel exit remains resident, confirm exit leaves browsers untouched.

Windows CI/manual check: close hides when enabled; when disabled, close follows Windows exit behavior and uses the same active-browser warning.

- [ ] **Step 4: Commit**

```bash
git add lib/app-store.js lib/ipc-handlers.js preload.js renderer/settings.html renderer/settings.js main.js test/app-store.test.js test/ipc-handlers.test.js
git commit -m "新增托盘行为设置"
```

### Task 4: Tray Documentation and Packaging Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: documented tray behavior and cross-platform checks.

- [ ] **Step 1: Document close, restore, and exit behavior**

State explicitly that manager exit does not close browsers and that unknown states trigger a warning.

- [ ] **Step 2: Run full verification and local packaging**

Run: `npm test && npm run build:mac && git diff --check`

Expected: tests pass, both macOS DMGs are produced, and electron-builder exits 0.

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "更新系统托盘使用说明"
```
