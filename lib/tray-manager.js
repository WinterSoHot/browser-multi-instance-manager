const MAX_DIRECT_FAVORITES = 20;
const DEFAULT_REFRESH_DEBOUNCE_MS = 150;

function sanitizeLabel(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const label = value.replace(/<[^>]*>/gu, '').trim();
  return label || fallback;
}

function normalizeStatuses(profileIds, statuses) {
  if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) {
    return Object.fromEntries(profileIds.map((profileId) => [
      profileId, { running: false, verificationUnavailable: true },
    ]));
  }

  return Object.fromEntries(profileIds.map((profileId) => {
    const status = statuses[profileId];
    if (!status || typeof status !== 'object' || typeof status.running !== 'boolean') {
      return [profileId, { running: false, verificationUnavailable: true }];
    }
    return [profileId, {
      running: status.running,
      verificationUnavailable: status.verificationUnavailable === true,
    }];
  }));
}

async function runWithConcurrency(items, limit, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        const result = await operation(items[index]);
        results[index] = result?.success === true
          ? { success: true }
          : { success: false, code: 'TRAY_LAUNCH_FAILED', error: 'Unable to launch favorite' };
      } catch {
        results[index] = { success: false, code: 'TRAY_LAUNCH_FAILED', error: 'Unable to launch favorite' };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function createTrayManager({
  Tray,
  Menu,
  createTrayIcon,
  showWindow,
  requestQuit,
  listProfiles,
  listFavoriteProfiles,
  listWorkspaces = () => [],
  getStatuses,
  launchProfiles,
  debounceMs = DEFAULT_REFRESH_DEBOUNCE_MS,
}) {
  let tray = null;
  let destroyed = false;
  let refreshPromise = null;
  let refreshTimer = null;
  let refreshDirty = false;
  let launchPromise = null;
  const listAllProfiles = typeof listProfiles === 'function'
    ? listProfiles : listFavoriteProfiles;

  const handleDoubleClick = () => {
    if (!destroyed) showWindow();
  };

  function getProfiles() {
    const profiles = listAllProfiles();
    return Array.isArray(profiles) ? profiles.filter((profile) => (
      profile && typeof profile.id === 'string' && profile.id.length > 0
    )) : [];
  }

  function getFavorites() {
    const profiles = listFavoriteProfiles();
    return Array.isArray(profiles) ? profiles.filter((profile) => (
      profile
      && profile.favorite === true
      && typeof profile.id === 'string'
      && profile.id.length > 0
    )) : [];
  }

  async function getForcedStatuses(profileIds) {
    try {
      return normalizeStatuses(profileIds, await getStatuses(profileIds, { force: true }));
    } catch {
      return normalizeStatuses(profileIds, null);
    }
  }

  function launchFavorites(profiles) {
    if (launchPromise || destroyed) return undefined;

    launchPromise = (async () => {
      const profileIds = profiles.map((profile) => profile.id);
      const statuses = await getForcedStatuses(profileIds);
      const launchable = profiles.filter((profile) => {
        const status = statuses[profile.id];
        return status.running !== true && status.verificationUnavailable !== true;
      });
      const results = await runWithConcurrency(launchable, 4, (profile) => launchProfiles(profile.id));
      scheduleRefresh();
      return results;
    })();

    launchPromise.finally(() => {
      launchPromise = null;
    }).catch(() => {});
    return launchPromise;
  }

  function buildFavoriteItems(favorites, statuses) {
    const visibleFavorites = favorites.slice(0, MAX_DIRECT_FAVORITES);
    const workspaceNames = new Map();
    const workspaces = listWorkspaces();
    if (Array.isArray(workspaces)) {
      for (const workspace of workspaces) {
        if (workspace && typeof workspace.id === 'string') {
          workspaceNames.set(workspace.id, sanitizeLabel(workspace.name, '未命名工作区'));
        }
      }
    }

    const grouped = new Map();
    const ungrouped = [];
    for (const profile of visibleFavorites) {
      if (profile.workspaceId && workspaceNames.has(profile.workspaceId)) {
        if (!grouped.has(profile.workspaceId)) grouped.set(profile.workspaceId, []);
        grouped.get(profile.workspaceId).push(profile);
      } else {
        ungrouped.push(profile);
      }
    }

    function profileItem(profile) {
      const status = statuses[profile.id] || { verificationUnavailable: true };
      return {
        label: sanitizeLabel(profile.name, '未命名配置'),
        enabled: status.running !== true && status.verificationUnavailable !== true,
        click: () => launchFavorites([profile]),
      };
    }

    const items = [];
    for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
      if (!workspace || !grouped.has(workspace.id)) continue;
      items.push({
        label: workspaceNames.get(workspace.id),
        submenu: grouped.get(workspace.id).map(profileItem),
      });
    }
    if (ungrouped.length > 0) {
      items.push({
        label: '未分组',
        submenu: ungrouped.map(profileItem),
      });
    }
    if (favorites.length > MAX_DIRECT_FAVORITES) {
      items.push({ label: '更多请在主界面操作', click: () => showWindow() });
    }
    return items;
  }

  function buildMenu(profiles, favorites, statuses) {
    let running = 0;
    let unknown = 0;
    for (const profile of profiles) {
      const status = statuses[profile.id];
      if (status?.verificationUnavailable === true) unknown += 1;
      else if (status?.running === true) running += 1;
    }

    return [
      { label: `正在运行 ${running}，状态未知 ${unknown}`, enabled: false },
      { type: 'separator' },
      { label: '打开主界面', click: () => showWindow() },
      { label: '启动全部收藏', click: () => launchFavorites(getFavorites()) },
      { type: 'separator' },
      ...buildFavoriteItems(favorites, statuses),
      { type: 'separator' },
      { label: '退出管理器', click: () => requestQuit() },
    ];
  }

  async function refresh() {
    if (destroyed || !tray) return undefined;
    if (refreshPromise) {
      refreshDirty = true;
      return refreshPromise;
    }

    refreshPromise = (async () => {
      do {
        refreshDirty = false;
        const profiles = getProfiles();
        const favorites = getFavorites();
        const statuses = await getForcedStatuses(profiles.map((profile) => profile.id));
        if (destroyed || !tray) return undefined;
        tray.setContextMenu(Menu.buildFromTemplate(buildMenu(profiles, favorites, statuses)));
      } while (refreshDirty && !destroyed);
      return undefined;
    })();

    refreshPromise.finally(() => {
      refreshPromise = null;
    }).catch(() => {});
    return refreshPromise;
  }

  function scheduleRefresh() {
    if (destroyed || refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (!destroyed) void refresh();
    }, debounceMs);
  }

  async function create() {
    if (destroyed || tray) return tray;
    tray = new Tray(createTrayIcon());
    tray.on('double-click', handleDoubleClick);
    await refresh();
    return tray;
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (tray) {
      tray.removeListener('double-click', handleDoubleClick);
      tray.destroy();
      tray = null;
    }
  }

  return {
    create,
    refresh,
    scheduleRefresh,
    destroy,
  };
}

module.exports = {
  MAX_DIRECT_FAVORITES,
  createTrayManager,
};
