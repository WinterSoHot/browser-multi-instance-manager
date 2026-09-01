# Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home screen readable and fully operable without page-level horizontal scrolling at the default 800×600 window size.

**Architecture:** Keep the current DOM and renderer behavior, with one small toolbar-order change and a title attribute for truncated names. Add explicit CSS layout contracts for the default, compact (`max-width: 900px`), and single-column (`max-width: 680px`) states. Verify structure through source-contract tests and appearance through packaged-app screenshots.

**Tech Stack:** Electron, CommonJS JavaScript, HTML, CSS, Node.js test runner

**Spec:** `docs/plans/2026-09-01-responsive-layout-design.md`

## Global Constraints

- The default 800×600 window must not have page-level horizontal scrolling.
- Preserve all existing controls, list/grid modes, colors, and renderer event bindings.
- Long profile names remain on one readable line with ellipsis and a full-name title.
- Keep at least 36px effective height for compact action controls.
- At `max-width: 680px`, workspace navigation becomes a non-sticky single-column row layout.

---

### Task 1: Add Responsive Layout Contracts

**Files:**
- Create: `test/responsive-layout-contract.test.js`
- Test: `test/responsive-layout-contract.test.js`

**Interfaces:**
- Consumes: static `renderer/index.html`, `renderer/index.js`, and `renderer/styles.css`
- Produces: source contracts for toolbar order, profile-name truncation, compact card flow, and single-column navigation

- [ ] **Step 1: Write the failing contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererDir = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(rendererDir, 'index.js'), 'utf8');
const styles = fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8');

test('primary create action precedes the secondary toolbar', () => {
  assert.ok(html.indexOf('id="openAddModal"') < html.indexOf('class="header-actions"'));
});

test('profile names expose full text while CSS keeps them on one line', () => {
  assert.match(source, /<h3 title="\$\{escapeHtml\(profile\.name\)\}">/u);
  assert.match(styles, /\.profile-info h3\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/su);
});

test('compact and narrow breakpoints prevent horizontal card overflow', () => {
  assert.match(styles, /@media \(max-width:\s*900px\)[\s\S]*\.profile-card\s*\{[^}]*flex-direction:\s*column;/u);
  assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*\.workspace-layout\s*\{[^}]*grid-template-columns:\s*1fr;/u);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test test/responsive-layout-contract.test.js`

Expected: FAIL because the add action is still inside the toolbar, profile names lack `title`, and the 900px/680px contracts do not exist.

- [ ] **Step 3: Commit the failing contract test**

```bash
git add test/responsive-layout-contract.test.js
git commit -m "新增响应式布局契约测试"
```

### Task 2: Restructure the Header and Profile Name

**Files:**
- Modify: `renderer/index.html:48-100`
- Modify: `renderer/index.js:317-326`
- Test: `test/responsive-layout-contract.test.js`

**Interfaces:**
- Consumes: existing IDs used by renderer event bindings
- Produces: `#openAddModal` as the title-row primary action and profile `<h3 title="…">` markup

- [ ] **Step 1: Move the existing add button before `.header-actions`**

```html
<div class="section-header">
  <h2>配置列表</h2>
  <button id="openAddModal" class="btn btn-primary">+ 新建配置</button>
  <div class="header-actions">
```

Keep the current toolbar children in their existing order after this opening tag, close both containers as they are today, and remove only the original duplicate `#openAddModal` at the end of `.header-actions`.

- [ ] **Step 2: Add a safe full-name title to the profile heading**

```js
<h3 title="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</h3>
```

- [ ] **Step 3: Run renderer behavior and contract tests**

Run: `node --test test/responsive-layout-contract.test.js test/view-utils.test.js test/profile-batch-ui-contract.test.js`

Expected: toolbar/name assertions pass; CSS breakpoint assertions remain failing until Task 3.

- [ ] **Step 4: Commit the semantic markup changes**

```bash
git add renderer/index.html renderer/index.js
git commit -m "优化配置列表工具栏结构"
```

### Task 3: Implement Compact Responsive CSS

**Files:**
- Modify: `renderer/styles.css:100-290`
- Modify: `renderer/styles.css:521-635`
- Modify: `renderer/styles.css:933-1198`
- Modify: `renderer/styles.css:1475-1605`
- Test: `test/responsive-layout-contract.test.js`

**Interfaces:**
- Consumes: `.section-header`, `#openAddModal`, `.header-actions`, `.workspace-layout`, `.profile-info`, and `.profile-actions`
- Produces: 900px compact two-column layout and 680px single-column layout

- [ ] **Step 1: Make all grid/flex content shrink safely**

```css
.workspace-layout,
.profiles-section,
.profile-info,
.profile-info h3 {
  min-width: 0;
}

.profile-info h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: Turn the section heading into a two-row grid**

```css
.profiles-section > .section-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.profiles-section > .section-header .header-actions {
  grid-column: 1 / -1;
  width: 100%;
}
```

- [ ] **Step 3: Add the compact 900px layout**

```css
@media (max-width: 900px) {
  .container { padding: 20px 16px; }
  .workspace-layout { grid-template-columns: 148px minmax(0, 1fr); gap: 14px; }
  .workspace-sidebar, section { padding: 14px; }
  .search-bar { align-items: stretch; flex-direction: column; }
  .filter-group { width: 100%; }
  .filter-btn { flex: 1 1 64px; text-align: center; }
  .profile-card { align-items: stretch; flex-direction: column; gap: 12px; }
  .profile-info, .profile-actions { width: 100%; }
  .profile-actions { justify-content: flex-start; }
  .profile-actions .btn, .workspace-assignment select { min-height: 36px; }
}
```

- [ ] **Step 4: Replace the old 768px single-column breakpoint with 680px**

Retain popup-menu behavior, but move single-column workspace, stacked header, and one-column grid rules into:

```css
@media (max-width: 680px) {
  .workspace-layout { grid-template-columns: 1fr; }
  .workspace-sidebar { position: static; }
  .workspace-filter-list,
  .workspace-custom-list,
  .workspace-batch-actions { flex-direction: row; flex-wrap: wrap; }
  .workspace-filter-btn,
  .workspace-batch-actions .btn { width: auto; }
}
```

- [ ] **Step 5: Run contract and full tests**

Run: `node --test test/responsive-layout-contract.test.js test/profile-batch-ui-contract.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 6: Commit the responsive CSS**

```bash
git add renderer/styles.css test/responsive-layout-contract.test.js
git commit -m "优化默认窗口响应式布局"
```

### Task 4: Visual and Packaging Verification

**Files:**
- Verify: `renderer/index.html`
- Verify: `renderer/styles.css`
- Verify: `dist/mac/Browser Multi-Instance Manager.app`

**Interfaces:**
- Consumes: completed responsive layout
- Produces: visual evidence at 800×600 and a locally packaged application

- [ ] **Step 1: Launch the app at the default 800×600 window**

Run: `npm start`

Check: no horizontal scrollbar; profile names do not wrap vertically; all profile actions are reachable; toolbar and filter groups are visually separated.

- [ ] **Step 2: Resize below 680px and inspect list/grid modes**

Check: sidebar becomes a wrapped top navigation; list and grid cards stay within the viewport; menus remain scroll-bounded and reachable.

- [ ] **Step 3: Run the final local package build**

Run: `npm run build:mac`

Expected: x64 and arm64 DMGs plus blockmaps, exit code 0.

- [ ] **Step 4: Launch and exit the packaged x64 app**

Check: the home screen matches the responsive contract and normal exit produces no uncaught exception.

- [ ] **Step 5: Commit any final visual corrections**

```bash
git add renderer/index.html renderer/index.js renderer/styles.css test/responsive-layout-contract.test.js
git commit -m "优化配置管理界面细节"
```
