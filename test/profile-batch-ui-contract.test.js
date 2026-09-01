const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

test('home page includes an accessible selected-profile organization menu', () => {
  assert.match(html, /id="organizeSelectedBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/u);
  assert.match(html, /id="organizeSelectedMenu"[^>]*role="menu"[^>]*hidden/u);
  assert.match(html, /id="organizeWorkspaceMenu"[^>]*role="menu"/u);
  assert.match(html, /data-organize-action="favorite"/u);
  assert.match(html, /data-organize-action="unfavorite"/u);
  assert.match(html, /data-organize-action="export"/u);
});

test('batch organizer module loads before the home-page entry point', () => {
  assert.ok(html.indexOf('profile-batch-organizer.js') < html.indexOf('index.js'));
  assert.match(source, /window\.profileBatchOrganizer/u);
  assert.match(source, /assignProfilesWorkspace/u);
  assert.match(source, /setProfilesFavorite/u);
  assert.match(source, /exportSelectedProfiles/u);
});

test('many workspace targets remain reachable in viewport-bounded scrolling menus', () => {
  assert.match(styles, /\.batch-organize-menu,\s*\.batch-organize-submenu\s*\{[^}]*max-height:\s*calc\(100vh - 32px\);[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.batch-organize-submenu\s*\{[^}]*max-height:[^;}]+;[^}]*overflow-y:\s*auto;/u);
  assert.match(source, /getOrganizationWorkspaceTargets\(workspaces\)/u);
  assert.match(source, /organizeWorkspaceMenu\.replaceChildren\(\.\.\.buttons\)/u);
});

test('organization action wiring distinguishes keyboard focus restoration from pointer closing', () => {
  assert.match(source, /event\.detail === 0 \? 'keyboard' : 'pointer'/u);
  assert.match(source, /focusOrganizationActionTarget\(activationType, true\)/u);
  assert.match(source, /focusOrganizationActionTarget\(activationType, false\)/u);
  assert.match(source, /pointerdown[\s\S]*?closeOrganizationMenu\(false\)/u);
});
