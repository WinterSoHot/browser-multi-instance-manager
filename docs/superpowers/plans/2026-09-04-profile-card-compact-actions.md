# Profile Card Compact Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded profile-card action row with a compact responsive layout that keeps launch, favorite, workspace, and a More menu directly available without overlap.

**Architecture:** Add a small renderer-side menu-state module for deterministic single-menu and keyboard behavior. Keep all profile operations in the existing `index.js` action dispatcher; generated card markup only changes where those actions are exposed. Use content-driven flex wrapping for wide cards plus explicit 900px/680px fallbacks, while preserving the grid-view layout.

**Tech Stack:** Electron renderer, CommonJS-compatible browser modules, vanilla JavaScript, HTML, CSS, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-09-04-profile-card-compact-actions-design.md`

## Global Constraints

- Keep existing profile operation functions, IPC boundaries, confirmations, and per-profile lifecycle coordination unchanged.
- Direct actions are launch/close, favorite, workspace assignment, and More.
- More contains open folder, profile size, new blank copy, rename, and delete; delete remains visually separated as dangerous.
- Only one menu is open; outside click, `Escape`, action completion, rerender, or profile removal closes it.
- The trigger uses `aria-haspopup="menu"`, `aria-expanded`, and a profile-specific accessible label.
- Menu interaction never toggles profile selection.
- Long names and workspace labels remain bounded and the document never gains horizontal overflow.
- Run `npm test` and `npm run build:mac`; inspect packaged layouts before integration approval.

---

### Task 1: Profile Menu State and Keyboard Navigation

**Files:**
- Create: `renderer/profile-card-menu.js`
- Create: `test/profile-card-menu.test.js`

**Interfaces:**
- Produces: `createProfileCardMenuState()` with `open(profileId)`, `toggle(profileId)`, `close()`, and `getSnapshot()` returning `{ openProfileId }`.
- Produces: `nextProfileCardMenuItemIndex(currentIndex, key, itemCount)` returning an integer or `null`.

- [ ] **Step 1: Write failing state and navigation tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProfileCardMenuState,
  nextProfileCardMenuItemIndex,
} = require('../renderer/profile-card-menu');

test('profile card menu state keeps at most one profile open', () => {
  const state = createProfileCardMenuState();
  state.open('profile-a');
  assert.deepEqual(state.getSnapshot(), { openProfileId: 'profile-a' });
  state.toggle('profile-b');
  assert.deepEqual(state.getSnapshot(), { openProfileId: 'profile-b' });
  state.toggle('profile-b');
  assert.deepEqual(state.getSnapshot(), { openProfileId: null });
});

test('profile card menu keyboard navigation wraps and supports edges', () => {
  assert.equal(nextProfileCardMenuItemIndex(0, 'ArrowUp', 5), 4);
  assert.equal(nextProfileCardMenuItemIndex(4, 'ArrowDown', 5), 0);
  assert.equal(nextProfileCardMenuItemIndex(2, 'Home', 5), 0);
  assert.equal(nextProfileCardMenuItemIndex(2, 'End', 5), 4);
  assert.equal(nextProfileCardMenuItemIndex(2, 'Escape', 5), null);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/profile-card-menu.test.js`

Expected: FAIL because `renderer/profile-card-menu.js` does not exist.

- [ ] **Step 3: Implement the isolated module**

```js
(function exposeProfileCardMenu(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.profileCardMenu = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function createProfileCardMenuState() {
    let openProfileId = null;
    return {
      open(profileId) { openProfileId = String(profileId); },
      toggle(profileId) {
        const target = String(profileId);
        openProfileId = openProfileId === target ? null : target;
      },
      close() { openProfileId = null; },
      getSnapshot() { return { openProfileId }; },
    };
  }

  function nextProfileCardMenuItemIndex(currentIndex, key, itemCount) {
    if (!Number.isSafeInteger(itemCount) || itemCount < 1) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return itemCount - 1;
    if (key === 'ArrowDown') return (currentIndex + 1 + itemCount) % itemCount;
    if (key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
    return null;
  }

  return { createProfileCardMenuState, nextProfileCardMenuItemIndex };
}));
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/profile-card-menu.test.js`

Expected: 2 tests pass.

- [ ] **Step 5: Commit the module**

```bash
git add renderer/profile-card-menu.js test/profile-card-menu.test.js
git commit -m "新增配置卡片菜单状态模块"
```

### Task 2: Accessible More Menu and Existing Action Routing

**Files:**
- Modify: `renderer/index.html:240-260`
- Modify: `renderer/index.js:294-350,540-570`
- Create: `test/profile-card-menu-ui-contract.test.js`

**Interfaces:**
- Consumes: `window.profileCardMenu.createProfileCardMenuState()` and `nextProfileCardMenuItemIndex()` from Task 1.
- Produces: card-local `[data-profile-menu-trigger]`, `[data-profile-menu]`, and existing `[data-profile-action]` menu items.
- Produces: `openProfileCardMenu(profileId, trigger)`, `closeProfileCardMenu({ restoreFocus })`, and `handleProfileCardMenuKeydown(event)` in `renderer/index.js`.

- [ ] **Step 1: Write failing renderer contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(renderer, 'index.js'), 'utf8');

test('profile More menu module loads before the renderer entry point', () => {
  assert.ok(html.indexOf('profile-card-menu.js') < html.indexOf('index.js'));
  assert.match(source, /window\.profileCardMenu/u);
});

test('rendered cards expose direct actions and an accessible More menu', () => {
  assert.match(source, /data-profile-action="toggle-favorite"/u);
  assert.match(source, /class="workspace-assignment"/u);
  assert.match(source, /data-profile-menu-trigger[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/u);
  for (const action of ['open-folder', 'profile-size', 'clone', 'rename', 'delete']) {
    assert.match(source, new RegExp(`role="menuitem"[^>]*data-profile-action="${action}"`, 'u'));
  }
});

test('menu closes without selecting its card', () => {
  assert.match(source, /data-profile-menu-trigger[\s\S]*stopPropagation\(\)/u);
  assert.match(source, /pointerdown[\s\S]*closeProfileCardMenu/u);
  assert.match(source, /event\.key === 'Escape'[\s\S]*closeProfileCardMenu/u);
  assert.match(source, /closeProfileCardMenu\(\{ restoreFocus: false \}\)[\s\S]*Promise\.resolve\(action/u);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node --test test/profile-card-menu-ui-contract.test.js`

Expected: FAIL because the module script and More-menu markup are absent.

- [ ] **Step 3: Load the module and initialize menu state**

Insert `<script src="profile-card-menu.js"></script>` immediately before `profile-batch-organizer.js`. In `index.js`, destructure the two Task 1 exports and create one `profileCardMenuState` near the other renderer state objects.

- [ ] **Step 4: Replace low-frequency inline buttons with menu markup**

Keep status, favorite, and workspace assignment directly inside `.profile-actions`. Replace the five low-frequency buttons with:

```js
<div class="profile-more">
  <button type="button" class="btn btn-secondary btn-small profile-more-trigger"
    data-profile-menu-trigger data-profile-id="${escapeHtml(profile.id)}"
    aria-haspopup="menu" aria-expanded="false"
    aria-label="${escapeHtml(profile.name)} 的更多操作">•••</button>
  <div class="profile-more-menu" data-profile-menu role="menu" hidden>
    <button type="button" role="menuitem" data-profile-action="open-folder" data-profile-id="${escapeHtml(profile.id)}">打开文件夹</button>
    <button type="button" role="menuitem" data-profile-action="profile-size" data-profile-id="${escapeHtml(profile.id)}">查看占用大小</button>
    <button type="button" role="menuitem" data-profile-action="clone" data-profile-id="${escapeHtml(profile.id)}">新建空白副本</button>
    <span class="profile-more-separator" role="separator"></span>
    <button type="button" role="menuitem" data-profile-action="rename" data-profile-id="${escapeHtml(profile.id)}">重命名</button>
    <button type="button" role="menuitem" class="danger" data-profile-action="delete" data-profile-id="${escapeHtml(profile.id)}">删除配置</button>
  </div>
</div>
```

- [ ] **Step 5: Implement open, close, focus, and action behavior**

Before replacing `profilesList.innerHTML`, call `closeProfileCardMenu({ restoreFocus: false })`. In the delegated click listener, handle `[data-profile-menu-trigger]` before `[data-profile-action]`, call `event.stopPropagation()`, toggle only that profile, update `hidden` and `aria-expanded`, and focus the first menu item when opened from keyboard. When a menu action is selected, close without focus restoration before dispatching the existing action map. Add document `pointerdown` outside-close and menu `keydown` handling for `Escape`, `Home`, `End`, `ArrowUp`, and `ArrowDown`.

- [ ] **Step 6: Run focused renderer tests and verify GREEN**

Run: `node --test test/profile-card-menu.test.js test/profile-card-menu-ui-contract.test.js test/profile-batch-ui-contract.test.js`

Expected: all menu and existing batch-menu tests pass.

- [ ] **Step 7: Commit the accessible menu integration**

```bash
git add renderer/index.html renderer/index.js test/profile-card-menu-ui-contract.test.js
git commit -m "优化配置卡片操作入口"
```

### Task 3: Content-Driven Card Layout and Responsive Styling

**Files:**
- Modify: `renderer/styles.css:946-1230,1540-1680`
- Modify: `test/responsive-layout-contract.test.js`
- Modify: `test/profile-card-menu-ui-contract.test.js`

**Interfaces:**
- Consumes: `.profile-more`, `.profile-more-trigger`, `.profile-more-menu`, and `.danger` markup from Task 2.
- Produces: a list card that wraps the complete action group below `.profile-info` when it no longer fits, with grid-view overrides preserved.

- [ ] **Step 1: Replace the draft column-layout assertion with failing final-layout assertions**

```js
test('list cards keep a compact row and move the complete action group when needed', () => {
  const card = extractRuleContaining(styles, '.profile-card', 'display: flex');
  const info = extractRule(styles, '.profile-info');
  const actions = extractRule(styles, '.profile-actions');
  assert.match(card, /flex-wrap:\s*wrap;/u);
  assert.match(card, /align-items:\s*center;/u);
  assert.match(info, /flex:\s*1 1 360px;/u);
  assert.match(actions, /flex-wrap:\s*nowrap;/u);
  assert.match(actions, /margin-left:\s*auto;/u);
  assert.doesNotMatch(card, /flex-direction:\s*column;/u);
});

test('profile More menu escapes card bounds and separates danger actions', () => {
  const card = extractRuleContaining(styles, '.profile-card', 'display: flex');
  const menu = extractRule(styles, '.profile-more-menu');
  assert.match(card, /overflow:\s*visible;/u);
  assert.match(menu, /position:\s*absolute;/u);
  assert.match(menu, /z-index:\s*[2-9]\d*;/u);
  assert.match(styles, /\.profile-more-menu\s+\.danger\s*\{[^}]*color:\s*var\(--danger/u);
});
```

- [ ] **Step 2: Run responsive and menu UI tests and verify RED**

Run: `node --test test/responsive-layout-contract.test.js test/profile-card-menu-ui-contract.test.js`

Expected: FAIL because the draft always-column layout and menu styles do not meet the approved design.

- [ ] **Step 3: Implement the wide and content-driven card layout**

Set `.profile-card` to `flex-direction: row`, `flex-wrap: wrap`, `align-items: center`, and `overflow: visible`. Set `.profile-info` to `flex: 1 1 360px; width: auto`. Set `.profile-actions` to `width: auto; margin-left: auto; flex-wrap: nowrap`. Preserve `min-width: 0` on the name container and ellipsis on the heading.

- [ ] **Step 4: Style the More popup and open stacking state**

Use `.profile-more { position: relative; }`, an absolute right-aligned menu with `min-width: 190px`, viewport-safe `max-height`, scroll overflow, focus-visible styling, a separator, and a danger row. Apply `.profile-card:has(.profile-more-trigger[aria-expanded="true"]) { z-index: 20; }` so the menu layers above following cards.

- [ ] **Step 5: Add responsive and grid overrides**

At `max-width: 900px`, set the action group to `width: 100%; margin-left: 0` so it moves intact below identity. At `max-width: 680px`, allow `.profile-actions` to wrap within the card and keep each direct control at least 36px high. In `.view-grid`, retain the stacked identity, set the action group to full width, and allow direct controls to wrap while the More trigger remains a fixed-size button.

- [ ] **Step 6: Run focused layout tests and verify GREEN**

Run: `node --test test/responsive-layout-contract.test.js test/profile-card-menu-ui-contract.test.js`

Expected: all layout and menu contracts pass.

- [ ] **Step 7: Commit final card styling**

```bash
git add renderer/styles.css test/responsive-layout-contract.test.js test/profile-card-menu-ui-contract.test.js
git commit -m "优化配置卡片响应式布局"
```

### Task 4: Regression, Packaging, and Visual Verification

**Files:**
- Verify: `renderer/index.html`
- Verify: `renderer/index.js`
- Verify: `renderer/styles.css`
- Verify: `renderer/profile-card-menu.js`
- Verify: `test/profile-card-menu.test.js`
- Verify: `test/profile-card-menu-ui-contract.test.js`
- Verify: `test/responsive-layout-contract.test.js`

**Interfaces:**
- Consumes: the completed menu module, renderer integration, and responsive CSS from Tasks 1–3.
- Produces: evidence that tests, packaged output, keyboard access, and target viewport layouts meet the spec.

- [ ] **Step 1: Run formatting and repository checks**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intentional task changes are present.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: every test passes with zero failures.

- [ ] **Step 3: Build both macOS architectures locally**

Run: `npm run build:mac`

Expected: electron-builder creates x64 and arm64 application/DMG outputs; local signing may be skipped when no Developer ID identity is installed.

- [ ] **Step 4: Inspect packaged layouts and interactions**

Launch the packaged x64 application with an isolated `--user-data-dir` and remote-debugging port. Create profiles with long names, then inspect list and grid views at widths 1536, 900, 800, and 680px. Confirm no document overflow, no control overlap, one open menu maximum, outside click and `Escape` closure, keyboard focus movement, correct direct/menu action routing, and selected-badge clearance.

- [ ] **Step 5: Record final repository state**

Run: `git log -4 --oneline && git status --short`

Expected: the design commit and three implementation commits are visible; no generated `dist/` or `.superpowers/` content is staged.
