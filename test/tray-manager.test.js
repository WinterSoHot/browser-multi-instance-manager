const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppLifecycle } = require('../lib/app-lifecycle');

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
  listProfiles,
  listFavoriteProfiles,
  getStatuses,
  launchProfiles,
  showWindow,
  requestQuit,
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
    showWindow: showWindow || (() => { showCalls += 1; }),
    requestQuit: requestQuit || (() => { quitCalls += 1; }),
    listProfiles: listProfiles || (() => profiles),
    listFavoriteProfiles: listFavoriteProfiles || (() => profiles.filter((item) => item.favorite)),
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
  assert.equal(findItem(menu, '未分组').submenu[0].label, 'Personal');
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
  const overflow = findItem(menu, '更多请在主界面操作');
  assert.equal(overflow.enabled, undefined);
  overflow.click();
  assert.equal(harness.showCalls, 1);
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

test('Electron tray callbacks consume asynchronous callback failures', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const harness = createHarness({
      profiles: Array.from({ length: 21 }, (_, index) => profile(`id-${index}`, `Profile ${index}`)),
      showWindow: async () => { throw new Error('window unavailable'); },
      requestQuit: async () => { throw new Error('quit unavailable'); },
    });
    await harness.manager.create();
    const menu = harness.templates.at(-1);

    assert.equal(harness.trays[0].handlers.get('double-click')(), undefined);
    assert.equal(findItem(menu, '打开主界面').click(), undefined);
    assert.equal(findItem(menu, '更多请在主界面操作').click(), undefined);
    assert.equal(findItem(menu, '退出管理器').click(), undefined);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('a rejected quit keeps the tray available for a successful retry', async () => {
  let manager;
  let destroyCalls = 0;
  let quitCalls = 0;
  const lifecycle = createAppLifecycle({
    platform: 'darwin',
    getCloseToTray: () => true,
    getActiveStatusCount: () => ({ running: 0, unknown: 0 }),
    confirmExit: async () => true,
    hideWindow: () => {},
    destroyTray: async () => {
      destroyCalls += 1;
      await manager.destroy();
    },
    quitApp: async () => {
      quitCalls += 1;
      if (quitCalls === 1) throw new Error('application quit rejected');
    },
  });
  const harness = createHarness({ requestQuit: lifecycle.requestQuit });
  manager = harness.manager;

  await manager.create();
  assert.equal(await lifecycle.requestQuit(), false);
  assert.equal(destroyCalls, 0);
  assert.equal(lifecycle.isQuitting(), false);

  assert.equal(harness.trays[0].handlers.get('double-click')(), undefined);
  assert.equal(harness.showCalls, 1);
  assert.equal(await lifecycle.requestQuit(), true);
  assert.equal(destroyCalls, 1);
  assert.equal(harness.trays[0].destroyed, true);
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

test('a refresh requested during a slow refresh runs once more with the newest profile metadata', async () => {
  let currentProfiles = [profile('old', 'Old', 'work')];
  let statusCalls = 0;
  let releaseStatuses;
  const statusesReady = new Promise((resolve) => { releaseStatuses = resolve; });
  const harness = createHarness({
    listProfiles: () => currentProfiles,
    listFavoriteProfiles: () => currentProfiles,
    getStatuses: async (profileIds) => {
      statusCalls += 1;
      if (statusCalls === 1) {
        return Object.fromEntries(profileIds.map((profileId) => [profileId, { running: false }]));
      }
      if (statusCalls === 2) await statusesReady;
      return Object.fromEntries(profileIds.map((profileId) => [profileId, { running: false }]));
    },
  });

  await harness.manager.create();
  const refresh = harness.manager.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  currentProfiles = [profile('new', 'New', 'work')];
  harness.manager.refresh();
  harness.manager.scheduleRefresh();
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseStatuses();
  await refresh;
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.ok(findItem(harness.templates.at(-1), 'New'));
  assert.equal(findItem(harness.templates.at(-1), 'Old'), null);
  assert.equal(statusCalls, 3);
});

test('destroy prevents a queued trailing refresh from rebuilding the menu', async () => {
  let statusCalls = 0;
  let releaseStatuses;
  const statusesReady = new Promise((resolve) => { releaseStatuses = resolve; });
  const harness = createHarness({
    getStatuses: async (profileIds) => {
      statusCalls += 1;
      if (statusCalls === 2) await statusesReady;
      return Object.fromEntries(profileIds.map((profileId) => [profileId, { running: false }]));
    },
  });

  await harness.manager.create();
  const initialMenus = harness.templates.length;
  const refresh = harness.manager.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  harness.manager.refresh();
  await harness.manager.destroy();
  releaseStatuses();
  await refresh;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(statusCalls, 2);
  assert.equal(harness.templates.length, initialMenus);
});
