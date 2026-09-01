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

test('primary create action precedes the secondary toolbar', () => {
  assert.ok(html.indexOf('id="openAddModal"') < html.indexOf('class="header-actions"'));
});

test('profile names expose full text while CSS keeps them on one line', () => {
  assert.match(source, /<h3 title="\$\{escapeHtml\(profile\.name\)\}">/u);
  const profileNameRule = extractRule(styles, '.profile-info h3');
  assert.match(profileNameRule, /white-space:\s*nowrap;/u);
  assert.match(profileNameRule, /text-overflow:\s*ellipsis;/u);
});

test('compact and narrow breakpoints prevent horizontal card overflow', () => {
  assert.match(styles, /@media \(max-width:\s*900px\)[\s\S]*\.profile-card\s*\{[^}]*flex-direction:\s*column;/u);
  assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*\.workspace-layout\s*\{[^}]*grid-template-columns:\s*1fr;/u);
});
