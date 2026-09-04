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
