const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererDir = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(rendererDir, 'index.js'), 'utf8');
const styles = fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8');

function extractRule(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'u'));
  return match ? match[1] : '';
}

function extractRuleContaining(css, selector, declaration) {
  let start = 0;
  while (start < css.length) {
    const selectorStart = css.indexOf(selector, start);
    if (selectorStart === -1) return '';
    const ruleEnd = css.indexOf('}', selectorStart);
    const rule = ruleEnd === -1 ? '' : css.slice(selectorStart, ruleEnd + 1);
    if (rule.includes(declaration)) return rule;
    start = selectorStart + selector.length;
  }
  return '';
}

function extractMediaBlock(css, mediaQuery) {
  const mediaStart = css.indexOf(`@media (${mediaQuery})`);
  if (mediaStart === -1) return '';
  const openingBrace = css.indexOf('{', mediaStart);
  if (openingBrace === -1) return '';
  let depth = 1;
  for (let index = openingBrace + 1; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }
  return '';
}

test('primary create action precedes the secondary toolbar', () => {
  const createActionPosition = html.indexOf('id="openAddModal"');
  const toolbarPosition = html.indexOf('class="header-actions"');
  assert.notEqual(createActionPosition, -1);
  assert.notEqual(toolbarPosition, -1);
  assert.ok(createActionPosition < toolbarPosition);
});

test('profile names expose full text while CSS keeps them on one line', () => {
  assert.match(source, /<h3 title="\$\{escapeHtml\(profile\.name\)\}">/u);
  const profileNameRule = extractRule(styles, '.profile-info h3');
  assert.match(profileNameRule, /white-space:\s*nowrap;/u);
  assert.match(profileNameRule, /text-overflow:\s*ellipsis;/u);
  assert.match(profileNameRule, /overflow:\s*hidden;/u);
});

test('grid-view profile names keep a bounded width for ellipsis', () => {
  const gridProfileNameRule = extractRule(styles, '.profiles-list.view-grid .profile-info h3');
  assert.match(gridProfileNameRule, /width:\s*100%;/u);
});

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

test('compact and narrow breakpoints prevent horizontal card overflow', () => {
  const compactStyles = extractMediaBlock(styles, 'max-width: 900px');
  const narrowStyles = extractMediaBlock(styles, 'max-width: 680px');
  assert.match(compactStyles, /\.profile-actions\s*\{[^}]*width:\s*100%;[^}]*margin-left:\s*0;/u);
  assert.match(compactStyles, /\.profile-actions\s+\.btn\s*\{[^}]*min-height:\s*36px;/u);
  assert.match(compactStyles, /\.header-actions\s+\.btn\s*,\s*\.sort-control\s+select\s*\{[^}]*min-height:\s*36px;/u);
  assert.match(narrowStyles, /\.workspace-layout\s*\{[^}]*grid-template-columns:\s*1fr;/u);
  assert.match(narrowStyles, /\.workspace-sidebar\s*\{[^}]*position:\s*static;/u);
  assert.match(narrowStyles, /\.workspace-filter-list,\s*\.workspace-custom-list,\s*\.workspace-batch-actions\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*wrap;/u);
  assert.doesNotMatch(narrowStyles, /\.profile-card\s*\{[^}]*flex-direction:\s*column;/u);
  assert.match(narrowStyles, /\.profile-actions\s*\{[^}]*flex-wrap:\s*wrap;/u);
  assert.match(narrowStyles, /\.profile-actions\s*>\s*\*\s*\{[^}]*min-height:\s*36px;/u);
});

test('profiles section keeps its decorative overlay inside the visible menu area', () => {
  const profilesSectionRule = extractRule(styles, '.profiles-section');
  const profilesOverlayRule = extractRule(styles, '.profiles-section::before');

  assert.match(profilesSectionRule, /overflow:\s*visible;/u);
  assert.match(profilesOverlayRule, /right:\s*0;/u);
});
