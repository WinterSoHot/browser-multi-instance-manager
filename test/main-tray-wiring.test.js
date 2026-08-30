const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('main wires the tray manager and lifecycle without any browser-close operation', () => {
  assert.match(mainSource, /require\(["']\.\/lib\/tray-manager["']\)/u);
  assert.match(mainSource, /require\(["']\.\/lib\/app-lifecycle["']\)/u);
  assert.match(mainSource, /createTrayManager\(\{/u);
  assert.match(mainSource, /createAppLifecycle\(\{/u);
  assert.doesNotMatch(mainSource, /requestQuit[\s\S]{0,600}close\(/u);
});

test('main routes close, before-quit, activate, and window-all-closed through lifecycle-safe window handling', () => {
  assert.match(mainSource, /mainWindow\.on\(["']close["'],[\s\S]*?handleWindowClose/u);
  assert.match(mainSource, /app\.on\(["']before-quit["'],[\s\S]*?handleBeforeQuit/u);
  assert.match(mainSource, /app\.on\(["']activate["'],[\s\S]*?showMainWindow/u);
  assert.match(mainSource, /app\.on\(["']window-all-closed["'],[\s\S]*?requestQuit/u);
  assert.doesNotMatch(mainSource, /window-all-closed[\s\S]{0,200}app\.quit\(\)/u);
});

test('main restores a hidden window and refreshes tray state from storage and process changes', () => {
  assert.match(mainSource, /function showMainWindow\(\)[\s\S]*?ensureMainWindow[\s\S]*?\.show\(\)[\s\S]*?\.focus\(/u);
  assert.match(mainSource, /onStateChange\(records\)[\s\S]*?trayManager\?\.scheduleRefresh\(\)/u);
  assert.match(mainSource, /store\.onDidAnyChange[\s\S]*?trayManager\?\.scheduleRefresh\(\)/u);
});

test('main builds exit counts from one forced bulk status snapshot and describes manager-only exit', () => {
  assert.match(mainSource, /browserProcessManager\.getStatuses\(profileIds, \{ force: true \}\)/u);
  assert.match(mainSource, /只退出管理器，不关闭浏览器/u);
});
