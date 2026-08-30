const test = require('node:test');
const assert = require('node:assert/strict');

let trayManager = {};
try {
  trayManager = require('../lib/tray-manager');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

const createTrayManager = trayManager.createTrayManager || (() => ({
  create: async () => {},
  refresh: async () => {},
  scheduleRefresh: () => {},
  destroy: async () => {},
}));

function profile(id, name, workspaceId = null) {
  return {
    id,
    name,
    browserType: 'chrome',
    favorite: true,
    workspaceId,
  };
}

function findItem(items, label) {
  for (const item of items) {
    if (item.label === label) return item;
    if (item.submenu) {
      const nested = findItem(item.submenu, label);
      if (nested) return nested;
    }
  }
  return null;
}

function createHarness({
  profiles = [profile('a', 'Account A', 'work')],
  workspaces = [{ id: 'work', name: 'Work' }],
  statuses = {},
  getStatuses,
  launchProfiles,
  debounceMs = 5,
} = {}) {
  const templates = [];
  const trays = [];
  const snapshotCalls = [];
  let showCalls = 0;
  let quitCalls = 0;
  class FakeTray {
    constructor(icon) {
      this.icon = icon;
      this.handlers = new Map();
      this.destroyed = false;
      trays.push(this);
    }

    on(event, handler) {
      this.handlers.set(event, handler);
    }

    removeListener(event, handler) {
      if (this.handlers.get(event) === handler) this.handlers.delete(event);
    }

    setContextMenu(template) {
      this.template = template;
      templates.push(template);
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const manager = createTrayManager({
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => template },
    createTrayIcon: () => 'safe-icon',
    showWindow: () => { showCalls += 1; },
    requestQuit: () => { quitCalls += 1; },
    listProfiles: () => profiles,
    listFavoriteProfiles: () => profiles.filter((item) => item.favorite),
    listWorkspaces: () => workspaces,
    getStatuses: getStatuses || ((profileIds, options) => {
      snapshotCalls.push({ profileIds, options });
      return statuses;
    }),
    launchProfiles: launchProfiles || (async () => ({ success: true })),
    debounceMs,
  });

  return {
    manager,
    templates,
    trays,
    snapshotCalls,
    get showCalls() { return showCalls; },
    get quitCalls() { return quitCalls; },
  };
}

test('tray menu shows sanitized active counts and favorites grouped by workspace', async () => {
  const harness = createHarness({
    profiles: [
      profile('work-a', 'Account A', 'work'),
      profile('plain', 'Personal'),
      profile('unsafe', '<b>Unsafe</b>', 'work'),
      { ...profile('stopped', 'Stopped'), favorite: false },
    ],
    statuses: {
      'work-a': { running: true },
      plain: { running: false, verificationUnavailable: true },
      unsafe: { running: false },
      stopped: { running: true },
    },
  });

  await harness.manager.create();
  const menu = harness.templates.at(-1);

  assert.match(menu[0].label, /正在运行 2/u);
  assert.match(menu[0].label, /状态未知 1/u);
  assert.equal(findItem(menu, 'Work').submenu[0].label, 'Account A');
  assert.equal(findItem(menu, 'Personal').submenu, undefined);
  assert.equal(findItem(menu, 'Unsafe').label, 'Unsafe');
  assert.equal(findItem(menu, 'Account A').enabled, false);
  assert.equal(findItem(menu, 'Personal').enabled, false);
  assert.equal(menu.every((item) => !String(item.label || '').includes('<')), true);
});

test('tray menu preserves workspace order and caps direct favorite entries at twenty', async () => {
  const workspaces = [{ id: 'later', name: 'Later' }, { id: 'first', name: 'First' }];
  const profiles = [
    profile('later-1', 'Later A', 'later'),
    profile('first-1', 'First A', 'first'),
    ...Array.from({ length: 20 }, (_, index) => profile(`plain-${index}`, `Plain ${index}`)),
  ];
  const harness = createHarness({ profiles, workspaces });

  await harness.manager.create();
  const menu = harness.templates.at(-1);
  const labels = menu.map((item) => item.label).filter(Boolean);

  assert.ok(labels.indexOf('Later') < labels.indexOf('First'));
  assert.equal(findItem(menu, 'Plain 17').label, 'Plain 17');
  assert.equal(findItem(menu, 'Plain 18'), null);
  assert.equal(findItem(menu, '更多请在主界面操作').enabled, false);
});

test('launch all uses one forced snapshot, skips running and unknown profiles, and caps concurrency at four', async () => {
  const profiles = [
    profile('running', 'Running'),
    profile('unknown', 'Unknown'),
    ...Array.from({ length: 5 }, (_, index) => profile(`stopped-${index}`, `Stopped ${index}`)),
  ];
  const launches = [];
  let active = 0;
  let peak = 0;
  const harness = createHarness({
    profiles,
    statuses: {
      running: { running: true },
      unknown: { running: false, verificationUnavailable: true },
      ...Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
        `stopped-${index}`, { running: false },
      ])),
    },
    async launchProfiles(profileId) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      launches.push(profileId);
      return { success: true };
    },
  });

  await harness.manager.create();
  harness.snapshotCalls.length = 0;
  const menu = harness.templates.at(-1);
  await findItem(menu, '启动全部收藏').click();

  assert.deepEqual(harness.snapshotCalls, [{
    profileIds: profiles.map((item) => item.id),
    options: { force: true },
  }]);
  assert.deepEqual(launches.sort(), [
    'stopped-0', 'stopped-1', 'stopped-2', 'stopped-3', 'stopped-4',
  ]);
  assert.equal(peak, 4);
});

test('tray launch is single-flight and replaces raw launch errors with stable outcomes', async () => {
  let release;
  let launchCalls = 0;
  const harness = createHarness({
    statuses: { a: { running: false } },
    launchProfiles: async () => {
      launchCalls += 1;
      await new Promise((resolve) => { release = resolve; });
      throw new Error('/Users/secret/browser');
    },
  });

  await harness.manager.create();
  const item = findItem(harness.templates.at(-1), 'Account A');
  const first = item.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await item.click(), undefined);
  release();
  await assert.doesNotReject(first);
  assert.equal(launchCalls, 1);
});

test('tray double-click restores the existing window and destroy cancels queued refreshes', async () => {
  const harness = createHarness();
  await harness.manager.create();
  const initialMenus = harness.templates.length;
  harness.trays[0].handlers.get('double-click')();
  assert.equal(harness.showCalls, 1);

  harness.manager.scheduleRefresh();
  await harness.manager.destroy();
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(harness.trays[0].destroyed, true);
  assert.equal(harness.templates.length, initialMenus);
  assert.equal(harness.trays[0].handlers.has('double-click'), false);
});

test('tray manager uses favorite profiles as its status scope when no full profile lister is supplied', async () => {
  const templates = [];
  const manager = createTrayManager({
    Tray: class {
      on() {}
      setContextMenu(template) { templates.push(template); }
      removeListener() {}
      destroy() {}
    },
    Menu: { buildFromTemplate: (template) => template },
    createTrayIcon: () => 'safe-icon',
    showWindow: () => {},
    requestQuit: () => {},
    listFavoriteProfiles: () => [profile('only', 'Only')],
    getStatuses: (profileIds) => ({ [profileIds[0]]: { running: false } }),
    launchProfiles: async () => ({ success: true }),
  });

  await manager.create();

  assert.match(templates[0][0].label, /正在运行 0/u);
});
