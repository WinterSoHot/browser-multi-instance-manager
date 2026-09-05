const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.js'), 'utf8').replace(/\r\n?/gu, '\n');
const start = source.indexOf('let focusedProfileMenuId = null;');
const resizeStart = source.indexOf("window.addEventListener('resize', () => {", start);
const end = source.indexOf('\n});', resizeStart) + '\n});'.length;

for (const expanded of [false, true]) {
  test(`resizing a focused menu restores the ${expanded ? 'expanded action' : 'menu trigger'}`, () => {
    assert.ok(start >= 0 && resizeStart > start && end > resizeStart);
    const listeners = {};
    const focused = [];
    let closed = false;
    const action = { focus: () => focused.push('action') };
    const card = { querySelector: () => action };
    const trigger = {
      dataset: { profileId: 'profile-a' },
      closest: () => card,
      getClientRects: () => expanded ? [] : [{}],
      focus: () => focused.push('trigger'),
    };
    const context = {
      document: { addEventListener: (name, callback) => { listeners[name] = callback; } },
      window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
      profileCardMenuState: { getSnapshot: () => ({ openProfileId: 'profile-a' }) },
      findProfileCardMenuTrigger: () => trigger,
      closeProfileCardMenu: () => { closed = true; },
    };
    vm.runInNewContext(source.slice(start, end), context);
    listeners.focusin({ target: { closest: () => ({ querySelector: () => trigger }) } });
    listeners.resize();
    assert.equal(closed, true);
    assert.deepEqual(focused, [expanded ? 'action' : 'trigger']);

    focused.length = 0;
    listeners.focusin({ target: { closest: () => null } });
    listeners.resize();
    assert.deepEqual(focused, [], 'resizing must not steal focus from another control');
  });
}
