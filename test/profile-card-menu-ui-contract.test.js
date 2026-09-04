const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(renderer, 'index.js'), 'utf8');
const styles = fs.readFileSync(path.join(renderer, 'styles.css'), 'utf8');

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

test('profile More menu module loads before the renderer entry point', () => {
  const menuModulePosition = html.indexOf('profile-card-menu.js');
  const rendererEntryPosition = html.indexOf('index.js');
  assert.notEqual(menuModulePosition, -1);
  assert.notEqual(rendererEntryPosition, -1);
  assert.ok(menuModulePosition < rendererEntryPosition);
  assert.match(source, /window\.profileCardMenu/u);
});

test('rendered cards expose direct actions and an accessible More menu', () => {
  assert.match(source, /data-profile-action="toggle-favorite"/u);
  assert.match(source, /class="workspace-assignment"/u);
  assert.match(source, /data-profile-menu-trigger[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/u);
  assert.match(source, /data-profile-menu role="menu" aria-label="\$\{escapeHtml\(profile\.name\)\} 的更多操作" hidden/u);
  for (const action of ['open-folder', 'profile-size', 'clone', 'rename', 'delete']) {
    assert.match(source, new RegExp(`role="menuitem"[^>]*data-profile-action="${action}"`, 'u'));
  }
});

test('profile More menu escapes card bounds and separates danger actions', () => {
  const card = extractRuleContaining(styles, '.profile-card', 'display: flex');
  const menu = extractRule(styles, '.profile-more-menu');
  assert.match(card, /overflow:\s*visible;/u);
  assert.match(menu, /position:\s*absolute;/u);
  assert.match(menu, /z-index:\s*[2-9]\d*;/u);
  assert.match(styles, /\.profile-more-menu\s+\.danger\s*\{[^}]*color:\s*var\(--danger/u);
});

test('hidden profile More menus have no painted display geometry', () => {
  const hiddenMenuRule = extractRule(styles, '.profile-more-menu[hidden]');
  assert.match(hiddenMenuRule, /display:\s*none;/u);
});

test('menu closes without selecting its card', () => {
  assert.match(source, /data-profile-menu-trigger[\s\S]*stopPropagation\(\)/u);
  assert.match(source, /pointerdown[\s\S]*closeProfileCardMenu/u);
  assert.match(source, /event\.key === 'Escape'[\s\S]*closeProfileCardMenu/u);
  assert.match(source, /getProfileCardMenuActivationType\(event\.detail\)/u);
  assert.match(source, /closeProfileCardMenu\(\{ restoreFocus: activationType === 'keyboard' \}\)[\s\S]*Promise\.resolve\(action/u);
});

test('keyboard menu action focus is restored after settlement with a modal guard', () => {
  assert.match(source, /document\.querySelector\('\.modal\.show'\) !== null/u);
  assert.match(source, /getProfileCardMenuActionFocusTarget\(\{/u);
  assert.match(source, /if \(activationType === 'keyboard'[^)]*\)[\s\S]*actionPromise\.finally\(\(\) =>\s*restoreProfileCardMenuActionFocus/u);
});

test('keyboard-visible profile actions and menu items use opaque high-contrast colors', () => {
  assert.match(styles, /--danger-text:\s*#b42318;/u);
  assert.match(styles, /\.profile-actions:focus-within,\s*\.profile-actions:has\(\.profile-more-trigger\[aria-expanded="true"\]\)\s*\{[^}]*opacity:\s*1;/u);
  assert.match(styles, /\.profile-more-menu button:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--primary\);/u);
  assert.match(styles, /\.profile-more-menu \.danger\s*\{[^}]*color:\s*var\(--danger-text\);/u);
});

test('menu surfaces are isolated before card selection handling', () => {
  const clickHandlerStart = source.indexOf("profilesList.addEventListener('click', (event) => {");
  const cardSelectionStart = source.indexOf("if (!button) {", clickHandlerStart);
  const menuSurfaceGuard = source.indexOf("const menu = event.target.closest('[data-profile-menu]');", clickHandlerStart);
  assert.notEqual(clickHandlerStart, -1);
  assert.notEqual(cardSelectionStart, -1);
  assert.ok(menuSurfaceGuard > clickHandlerStart && menuSurfaceGuard < cardSelectionStart);
  assert.match(
    source.slice(menuSurfaceGuard, cardSelectionStart),
    /if \(menu && profilesList\.contains\(menu\) && !button\) \{[\s\S]*event\.stopPropagation\(\);[\s\S]*return;/u,
  );
});

test('Escape closes an open menu before requiring a menu-item target', () => {
  const keydownStart = source.indexOf('function handleProfileCardMenuKeydown(event) {');
  const menuItemGuard = source.indexOf('if (!menu || !menuItem || !menu.contains(menuItem)) return;', keydownStart);
  const escapeClose = source.indexOf("if (event.key === 'Escape' && profileCardMenuState.getSnapshot().openProfileId !== null)", keydownStart);
  assert.notEqual(keydownStart, -1);
  assert.notEqual(menuItemGuard, -1);
  assert.ok(escapeClose > keydownStart && escapeClose < menuItemGuard);
  assert.match(
    source.slice(escapeClose, menuItemGuard),
    /event\.preventDefault\(\);[\s\S]*closeProfileCardMenu\(\{ restoreFocus: true \}\);[\s\S]*return;/u,
  );
});
