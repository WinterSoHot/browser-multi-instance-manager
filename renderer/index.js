// Render process logic - Main page

const {
  createNonOverlappingTask,
  createSingleFlightTask,
  chunkItems,
  escapeHtml,
  filterCloseableProfileIds,
  formatBatchErrors,
  getUnknownStatusPrimaryAction,
  mapWithConcurrency,
  normalizeStatusSnapshot,
  isEditableTarget,
  summarizeResults,
} = window.viewUtils;
const { createProfileState } = window.profileState;

const profileState = createProfileState();
let currentRenameId = null;
let busyProfiles = new Set();
let statusCheckInterval = null;
let statusRefreshTimer = null;
let currentViewMode = 'list'; // 'list' or 'grid'

// Toast notification system
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" type="button">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());

  container.appendChild(toast);

  // Auto remove after 3 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.animation = 'slideOut 0.3s var(--transition)';
      setTimeout(() => toast.remove(), 300);
    }
  }, 3000);
}

// Load profiles on startup
async function loadProfiles() {
  profileState.setProfiles(await window.browserAPI.getProfiles());
  try {
    await refreshAllStatuses();
  } catch (error) {
    showToast(`加载进程状态失败：${error.message}`, 'warning');
  }
  renderProfiles();

  // Start polling browser status
  startStatusPolling();
}

async function refreshStatuses(forceProfileId = null) {
  let snapshot;
  if (forceProfileId) {
    snapshot = { [forceProfileId]: await window.browserAPI.refreshBrowserStatus(forceProfileId) };
  } else {
    const { profiles } = profileState.getSnapshot();
    const profileIdChunks = chunkItems(profiles.map((profile) => profile.id), 500);
    const snapshots = await mapWithConcurrency(
      profileIdChunks,
      1,
      (profileIds) => window.browserAPI.getBrowserStatuses(profileIds),
    );
    snapshot = Object.assign({}, ...snapshots);
  }
  const normalized = normalizeStatusSnapshot(snapshot);
  if (forceProfileId) {
    const current = profileState.getSnapshot();
    const runningIds = new Set(current.runningIds);
    const unknownIds = new Set(current.unknownIds);
    const retryableCloseIds = new Set(current.retryableCloseIds);
    runningIds.delete(forceProfileId);
    unknownIds.delete(forceProfileId);
    retryableCloseIds.delete(forceProfileId);
    if (normalized.runningIds.includes(forceProfileId)) runningIds.add(forceProfileId);
    if (normalized.unknownIds.includes(forceProfileId)) unknownIds.add(forceProfileId);
    if (normalized.retryableCloseIds.includes(forceProfileId)) {
      retryableCloseIds.add(forceProfileId);
    }
    profileState.setStatuses({ runningIds, unknownIds, retryableCloseIds });
  } else {
    profileState.setStatuses(normalized);
  }
  updateVisibleStatusCards();
}

const refreshAllStatuses = createSingleFlightTask(() => refreshStatuses());

// Poll browser status every 2 seconds
function startStatusPolling() {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }

  const pollStatus = createNonOverlappingTask(async () => {
    if (document.hidden) return;
    try {
      await refreshAllStatuses();
    } catch {
      // Keep the last known state and retry during the next fallback pass.
    }
  });

  statusCheckInterval = setInterval(pollStatus, 10000);
}

function getVisibleProfiles() {
  return profileState.getVisibleProfiles();
}

function getStatusMarkup(profile, statusSnapshot = profileState.getSnapshot()) {
  const { runningIds, unknownIds, retryableCloseIds } = statusSnapshot;
  const isUnknown = unknownIds.includes(profile.id);
  const isRunning = runningIds.includes(profile.id);
  const isBusy = busyProfiles.has(profile.id);
  const btnClass = isRunning ? 'btn-danger' : 'btn-success';
  const btnText = isBusy ? '处理中…' : (isRunning ? '关闭' : '启动');
  const launchFunc = isRunning ? 'closeBrowserOnly' : 'launchBrowserOnly';
  if (isUnknown) {
    const primaryAction = getUnknownStatusPrimaryAction(
      retryableCloseIds.includes(profile.id),
    );
    return `
      <span class="status-unknown" title="无法确认上次记录的浏览器进程">状态未知</span>
      <button class="btn ${primaryAction.className} btn-small" ${isBusy ? 'disabled' : ''} data-profile-action="${primaryAction.action}" data-profile-id="${escapeHtml(profile.id)}">${isBusy ? '处理中…' : primaryAction.label}</button>
      <button class="btn btn-secondary btn-small" data-profile-action="forget-process" data-profile-id="${escapeHtml(profile.id)}">仅清除记录</button>`;
  }
  return `<button class="btn ${btnClass} btn-small" ${isBusy ? 'disabled' : ''} data-profile-action="${launchFunc}" data-profile-id="${escapeHtml(profile.id)}">${btnText}</button>`;
}

// Render profiles list
function renderProfiles() {
  const profilesList = document.getElementById('profilesList');
  const snapshot = profileState.getSnapshot();
  const { filter, query, selectedIds } = snapshot;
  const selectedProfiles = new Set(selectedIds);

  // Filter profiles based on current filter and search query
  const filteredProfiles = getVisibleProfiles();

  if (filteredProfiles.length === 0) {
    const hasActiveFilter = filter !== 'all' || query !== '';
    profilesList.innerHTML = `<p class="empty-message">${hasActiveFilter ? '没有找到匹配的配置' : '暂无配置，请点击上方按钮添加'}</p>`;
    updateSelectAllButton();
    updateLaunchSelectedButton();
    updateCloseSelectedButton();
    return;
  }

  profilesList.innerHTML = filteredProfiles.map(profile => {
    const isSelected = selectedProfiles.has(profile.id);

    return `
    <div class="profile-card ${escapeHtml(profile.browserType)} ${isSelected ? 'selected' : ''}" data-id="${escapeHtml(profile.id)}">
      <div class="profile-info">
        <label class="checkbox-label">
          <input type="checkbox" class="profile-checkbox" data-id="${escapeHtml(profile.id)}" ${isSelected ? 'checked' : ''}>
          <span class="checkbox-custom"></span>
        </label>
        <h3>${escapeHtml(profile.name)}</h3>
        <span class="browser-type">
          ${getBrowserIcon(profile.browserType)}
          ${escapeHtml(profile.browserType)}
        </span>
      </div>
      <div class="profile-actions">
        <span class="profile-status-actions">${getStatusMarkup(profile, snapshot)}</span>
        <button class="btn btn-secondary btn-small" data-profile-action="open-folder" data-profile-id="${escapeHtml(profile.id)}">文件夹</button>
        <button class="btn btn-secondary btn-small" data-profile-action="profile-size" data-profile-id="${escapeHtml(profile.id)}">大小</button>
        <button class="btn btn-secondary btn-small" data-profile-action="clone" data-profile-id="${escapeHtml(profile.id)}">新建空白副本</button>
        <button class="btn btn-warning btn-small" data-profile-action="rename" data-profile-id="${escapeHtml(profile.id)}">重命名</button>
        <button class="btn btn-danger btn-small" data-profile-action="delete" data-profile-id="${escapeHtml(profile.id)}">删除</button>
      </div>
      <div class="selected-badge">✓</div>
    </div>
  `}).join('');

  updateSelectAllButton();
  updateLaunchSelectedButton();
  updateCloseSelectedButton();
}

document.getElementById('profilesList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-profile-action]');
  if (!button) {
    const card = event.target.closest('.profile-card');
    if (card && !event.target.closest('input') && !event.target.closest('.checkbox-label')) {
      toggleProfileSelection(card.dataset.id);
    }
    return;
  }

  const profileId = button.dataset.profileId;
  const actions = {
    launchBrowserOnly,
    closeBrowserOnly,
    'open-folder': openProfileFolder,
    'profile-size': showProfileSize,
    clone: cloneProfile,
    'refresh-status': refreshUnknownStatus,
    'forget-process': forgetProcess,
    rename: renameProfile,
    delete: deleteProfile
  };
  const action = actions[button.dataset.profileAction];
  if (action) {
    void Promise.resolve(action(profileId)).catch((error) => {
      showToast(`操作失败：${error.message}`, 'error');
    });
  }
});

document.getElementById('profilesList').addEventListener('change', (event) => {
  if (event.target.matches('.profile-checkbox')) {
    event.stopPropagation();
    toggleProfileSelection(event.target.dataset.id);
  }
});

function updateVisibleStatusCards() {
  const snapshot = profileState.getSnapshot();
  const { profiles } = snapshot;
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  document.querySelectorAll('.profile-card').forEach((card) => {
    const profile = profilesById.get(card.dataset.id);
    const statusContainer = card.querySelector('.profile-status-actions');
    if (profile && statusContainer) {
      statusContainer.innerHTML = getStatusMarkup(profile, snapshot);
    }
  });
  updateLaunchSelectedButton();
  updateCloseSelectedButton();
}

// Get browser icon SVG
function getBrowserIcon(browserType) {
  const icons = {
    chrome: `<svg class="browser-type-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#4285F4" fill-opacity="0.15"/><circle cx="12" cy="12" r="5" fill="#4285F4"/><path d="M12 7a5 5 0 015 5h5a10 10 0 00-10-10v5z" fill="#EA4335"/><path d="M12 17a5 5 0 01-5-5H2a10 10 0 0010 10v-5z" fill="#FBBC04"/><path d="M17 12a5 5 0 01-5 5v5a10 10 0 0010-10h-5z" fill="#34A853"/></svg>`,
    firefox: `<svg class="browser-type-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#FF7139" fill-opacity="0.15"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-.29.02-.58.05-.86C6.24 12.36 8.9 14 12 14c2.21 0 4.21-.87 5.68-2.28.21.71.32 1.47.32 2.28 0 4.41-3.59 8-8 8z" fill="#FF7139"/></svg>`,
    edge: `<svg class="browser-type-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#0078D7" fill-opacity="0.15"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 14.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5c.84 0 1.61.3 2.21.79L14 7l1.5 1.5-1.29 1.29c.49.6.79 1.37.79 2.21 0 1.93-1.57 3.5-3.5 3.5z" fill="#0078D7"/></svg>`,
    zen: `<svg class="browser-type-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#5C5CE0" fill-opacity="0.15"/><path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.5L18 8v8l-6 3.5L6 16V8l6-3.5z" fill="#5C5CE0"/></svg>`
  };
  return icons[browserType] || '';
}

// Add new profile
document.getElementById('addProfileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.currentTarget.dataset.busy === 'true') return;

  const browserType = document.getElementById('browserType').value;
  const profileName = document.getElementById('profileName').value.trim();

  if (!profileName) {
    showToast('请输入配置名称', 'warning');
    return;
  }

  const submitButton = e.currentTarget.querySelector('[type="submit"]');
  e.currentTarget.dataset.busy = 'true';
  submitButton.disabled = true;
  try {
    const result = await window.browserAPI.addProfile(browserType, profileName);
    if (result.success) {
      const { profiles } = profileState.getSnapshot();
      profileState.setProfiles([...profiles, result.profile]);
      profileState.clearSelection(); // Clear selection when adding new profile
      renderProfiles();
      document.getElementById('profileName').value = '';
      document.getElementById('addModal').classList.remove('show');
      showToast(`已新建配置 "${profileName}"`, 'success');
    } else {
      showToast('错误：' + result.error, 'error');
    }
  } catch (error) {
    showToast(`新建配置失败：${error.message}`, 'error');
  } finally {
    delete e.currentTarget.dataset.busy;
    submitButton.disabled = false;
  }
});

// Delete profile
async function deleteProfile(profileId) {
  if (!confirm('确定从列表移除此配置吗？')) {
    return;
  }
  const trashData = confirm('是否同时将本地浏览器数据移入系统废纸篓？\n选择“取消”将保留数据。');
  const initialSnapshot = profileState.getSnapshot();
  const runningBrowsers = new Set(initialSnapshot.runningIds);

  // If browser is running, close it first
  if (runningBrowsers.has(profileId)) {
    const closeResult = await window.browserAPI.closeBrowser(profileId);
    if (!closeResult.success) {
      showToast('关闭浏览器失败：' + closeResult.error, 'error');
      return;
    }
    const statusSnapshot = profileState.getSnapshot();
    const runningIds = new Set(statusSnapshot.runningIds);
    runningIds.delete(profileId);
    profileState.setStatuses({
      runningIds,
      unknownIds: statusSnapshot.unknownIds,
      retryableCloseIds: statusSnapshot.retryableCloseIds,
    });
  }

  // Remove from selection if selected
  if (profileState.getSnapshot().selectedIds.includes(profileId)) {
    profileState.toggleSelection(profileId);
  }

  const result = await window.browserAPI.deleteProfile(profileId, trashData);

  if (result.success) {
    profileState.setProfiles(
      profileState.getSnapshot().profiles.filter(p => p.id !== profileId),
    );
    renderProfiles();
    showToast(trashData ? '配置数据已移入系统废纸篓' : '已从列表移除，本地浏览器数据已保留', 'success');
  } else {
    showToast('错误：' + result.error, 'error');
  }
}

// Launch browser only (supports multiple instances)
async function launchBrowserOnly(profileId) {
  if (busyProfiles.has(profileId)) return;
  busyProfiles.add(profileId);
  updateVisibleStatusCards();
  try {
    const result = await window.browserAPI.launchBrowser(profileId);
    if (result.success) {
      const snapshot = profileState.getSnapshot();
      profileState.setStatuses({
        runningIds: [...snapshot.runningIds, profileId],
        unknownIds: snapshot.unknownIds,
        retryableCloseIds: snapshot.retryableCloseIds,
      });
      showToast('浏览器已启动', 'success');
    } else {
      showToast('启动浏览器失败：' + result.error, 'error');
    }
  } finally {
    busyProfiles.delete(profileId);
    updateVisibleStatusCards();
  }
}

// Close browser
async function closeBrowserOnly(profileId) {
  if (busyProfiles.has(profileId)) return;
  busyProfiles.add(profileId);
  updateVisibleStatusCards();
  try {
    const result = await window.browserAPI.closeBrowser(profileId);
    if (result.success) {
      const snapshot = profileState.getSnapshot();
      profileState.setStatuses({
        runningIds: snapshot.runningIds.filter((id) => id !== profileId),
        unknownIds: snapshot.unknownIds.filter((id) => id !== profileId),
        retryableCloseIds: snapshot.retryableCloseIds.filter((id) => id !== profileId),
      });
      showToast('浏览器已关闭', 'success');
    } else {
      showToast('关闭浏览器失败：' + result.error, 'error');
      await refreshStatuses(profileId).catch(() => {});
    }
  } finally {
    busyProfiles.delete(profileId);
    updateVisibleStatusCards();
  }
}

async function cloneProfile(profileId) {
  if (busyProfiles.has(profileId)) return;
  busyProfiles.add(profileId);
  updateVisibleStatusCards();
  try {
    const result = await window.browserAPI.cloneProfile(profileId);
    if (!result.success) {
      showToast('新建空白副本失败：' + result.error, 'error');
      return;
    }
    const { profiles } = profileState.getSnapshot();
    profileState.setProfiles([...profiles, result.profile]);
    renderProfiles();
    showToast(`已创建 "${result.profile.name}"`, 'success');
  } finally {
    busyProfiles.delete(profileId);
    updateVisibleStatusCards();
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function showProfileSize(profileId) {
  if (busyProfiles.has(profileId)) return;
  busyProfiles.add(profileId);
  updateVisibleStatusCards();
  try {
    showToast('正在计算配置数据大小…', 'info');
    const result = await window.browserAPI.getProfileSize(profileId);
    showToast(
      result.success ? `配置数据大小：${formatBytes(result.bytes)}` : `计算失败：${result.error}`,
      result.success ? 'success' : 'error',
    );
  } finally {
    busyProfiles.delete(profileId);
    updateVisibleStatusCards();
  }
}

async function refreshUnknownStatus(profileId) {
  try {
    await refreshStatuses(profileId);
    const isUnknown = profileState.getSnapshot().unknownIds.includes(profileId);
    showToast(isUnknown ? '仍无法确认进程状态' : '进程状态已更新', isUnknown ? 'warning' : 'success');
  } catch (error) {
    showToast(`检测失败：${error.message}`, 'error');
  }
}

async function forgetProcess(profileId) {
  if (!confirm('仅清除管理器中的进程记录，不会关闭浏览器。\n如果该浏览器仍在运行，再次启动此配置可能造成数据冲突。确定继续吗？')) {
    return;
  }
  const result = await window.browserAPI.forgetBrowserProcess(profileId, true);
  if (!result.success) {
    showToast(`忽略失败：${result.error}`, 'error');
    return;
  }
  const snapshot = profileState.getSnapshot();
  profileState.setStatuses({
    runningIds: snapshot.runningIds.filter((id) => id !== profileId),
    unknownIds: snapshot.unknownIds.filter((id) => id !== profileId),
    retryableCloseIds: snapshot.retryableCloseIds.filter((id) => id !== profileId),
  });
  updateVisibleStatusCards();
  showToast('已清除旧进程记录，未终止任何进程', 'success');
}

// Open profile folder
async function openProfileFolder(profileId) {
  const result = await window.browserAPI.openProfileFolder(profileId);

  if (!result.success) {
    showToast('打开文件夹失败：' + result.error, 'error');
  }
}

// Rename profile
async function renameProfile(profileId) {
  const { profiles } = profileState.getSnapshot();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) {
    showToast('错误：配置不存在', 'error');
    return;
  }

  currentRenameId = profileId;
  document.getElementById('newProfileName').value = profile.name;
  document.getElementById('renameModal').classList.add('show');
  document.getElementById('newProfileName').focus();
}

// Modal event handlers
document.getElementById('confirmRename').addEventListener('click', async () => {
  const newName = document.getElementById('newProfileName').value.trim();

  if (!newName) {
    showToast('请输入名称', 'warning');
    return;
  }

  const { profiles } = profileState.getSnapshot();
  const profile = profiles.find(p => p.id === currentRenameId);
  if (newName === profile.name) {
    closeModal();
    return;
  }

  const result = await window.browserAPI.renameProfile(currentRenameId, newName);

  if (result.success) {
    const p = profiles.find(p => p.id === currentRenameId);
    if (p) {
      p.name = result.profile.name;
      p.path = result.profile.path;
    }
    profileState.setProfiles(profiles);
    renderProfiles();
    closeModal();
    showToast(`已重命名为 "${newName}"`, 'success');
  } else {
    showToast('错误：' + result.error, 'error');
  }
});

document.getElementById('cancelRename').addEventListener('click', closeModal);

function closeModal() {
  document.getElementById('renameModal').classList.remove('show');
  currentRenameId = null;
}

// Close modal on outside click
document.getElementById('renameModal').addEventListener('click', (e) => {
  if (e.target.id === 'renameModal') {
    closeModal();
  }
});

// Close modal on Enter key
document.getElementById('newProfileName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('confirmRename').click();
  } else if (e.key === 'Escape') {
    closeModal();
  }
});

// Add profile modal event handlers
document.getElementById('openAddModal').addEventListener('click', () => {
  document.getElementById('browserType').value = 'chrome';
  document.getElementById('profileName').value = '';
  document.getElementById('addModal').classList.add('show');
  document.getElementById('profileName').focus();
});

document.getElementById('cancelAdd').addEventListener('click', () => {
  document.getElementById('addModal').classList.remove('show');
});

// Close modal on outside click
document.getElementById('addModal').addEventListener('click', (e) => {
  if (e.target.id === 'addModal') {
    document.getElementById('addModal').classList.remove('show');
  }
});

// Close modal on Enter key in add form
document.getElementById('profileName').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('addModal').classList.remove('show');
  }
});

// Settings button handler
document.getElementById('openSettings').addEventListener('click', () => {
  window.location.href = 'settings.html';
});

// Launch selected profiles
document.getElementById('launchSelectedBtn').addEventListener('click', async () => {
  const snapshot = profileState.getSnapshot();
  const selectedProfiles = new Set(snapshot.selectedIds);
  const runningBrowsers = new Set(snapshot.runningIds);
  const unknownBrowsers = new Set(snapshot.unknownIds);
  if (selectedProfiles.size === 0) {
    showToast('请先选择要启动的配置', 'warning');
    return;
  }

  const toLaunch = Array.from(selectedProfiles).filter(
    id => !runningBrowsers.has(id) && !unknownBrowsers.has(id),
  );

  if (toLaunch.length === 0) {
    showToast('已选中的配置都已启动', 'info');
    return;
  }

  const launchButton = document.getElementById('launchSelectedBtn');
  launchButton.disabled = true;
  const results = await mapWithConcurrency(toLaunch, 4, async (profileId) => {
    let result;
    try {
      result = await window.browserAPI.launchBrowser(profileId);
    } catch (error) {
      result = { success: false, error: error.message };
    }
    return result;
  }, (completed, total) => {
    launchButton.textContent = `启动中 ${completed}/${total}`;
  });
  launchButton.disabled = false;
  launchButton.innerHTML = '启动选中 (<span id="selectedCount">0</span>)';
  const statusSnapshot = profileState.getSnapshot();
  const updatedRunningIds = new Set(statusSnapshot.runningIds);
  results.forEach((result, index) => {
    if (result.success) updatedRunningIds.add(toLaunch[index]);
  });
  profileState.setStatuses({
    runningIds: updatedRunningIds,
    unknownIds: statusSnapshot.unknownIds,
    retryableCloseIds: statusSnapshot.retryableCloseIds,
  });

  // Clear selection after launch
  profileState.clearSelection();
  renderProfiles();
  showBatchResult('启动', results);
});

// Close selected profiles
document.getElementById('closeSelectedBtn').addEventListener('click', async () => {
  const snapshot = profileState.getSnapshot();
  const selectedProfiles = new Set(snapshot.selectedIds);
  const runningBrowsers = new Set(snapshot.runningIds);
  const unknownBrowsers = new Set(snapshot.unknownIds);
  const retryableCloseBrowsers = new Set(snapshot.retryableCloseIds);
  if (selectedProfiles.size === 0) {
    showToast('请先选择要关闭的配置', 'warning');
    return;
  }

  const toClose = filterCloseableProfileIds(
    selectedProfiles,
    runningBrowsers,
    retryableCloseBrowsers,
  );

  if (toClose.length === 0) {
    showToast('已选中的配置都已关闭', 'info');
    return;
  }

  const closeButton = document.getElementById('closeSelectedBtn');
  closeButton.disabled = true;
  toClose.forEach((profileId) => busyProfiles.add(profileId));
  updateVisibleStatusCards();
  const results = await mapWithConcurrency(toClose, 4, async (profileId) => {
    let result;
    try {
      result = await window.browserAPI.closeBrowser(profileId);
    } catch (error) {
      result = { success: false, error: error.message };
    }
    return result;
  }, (completed, total) => {
    closeButton.textContent = `关闭中 ${completed}/${total}`;
  });
  toClose.forEach((profileId) => busyProfiles.delete(profileId));
  closeButton.disabled = false;
  closeButton.innerHTML = '关闭选中 (<span id="closeSelectedCount">0</span>)';
  const statusSnapshot = profileState.getSnapshot();
  const runningIds = new Set(statusSnapshot.runningIds);
  const unknownIds = new Set(statusSnapshot.unknownIds);
  const retryableCloseIds = new Set(statusSnapshot.retryableCloseIds);
  results.forEach((result, index) => {
    if (!result.success) return;
    const profileId = toClose[index];
    runningIds.delete(profileId);
    unknownIds.delete(profileId);
    retryableCloseIds.delete(profileId);
  });
  profileState.setStatuses({ runningIds, unknownIds, retryableCloseIds });
  await refreshAllStatuses().catch(() => {});

  // Clear selection after close
  profileState.clearSelection();
  renderProfiles();
  showBatchResult('关闭', results);
});

function showBatchResult(action, results) {
  const { successCount, failureCount, errors } = summarizeResults(results);
  if (failureCount === 0) {
    showToast(`已${action} ${successCount} 个浏览器`, 'success');
    return;
  }

  const details = errors.length > 0 ? `：${formatBatchErrors(errors)}` : '';
  const type = successCount > 0 ? 'warning' : 'error';
  showToast(`${action}成功 ${successCount} 个，失败 ${failureCount} 个${details}`, type);
}

// Select all profiles - 只更新必要的 DOM，避免整体闪烁
document.getElementById('selectAllBtn').addEventListener('click', () => {
  toggleSelectVisibleProfiles();
});

function toggleSelectVisibleProfiles() {
  const { selectedIds } = profileState.getSnapshot();
  const selectedProfiles = new Set(selectedIds);
  const allIds = getVisibleProfiles().map(p => p.id);
  const allSelected = allIds.every(id => selectedProfiles.has(id));

  if (allSelected) {
    // 取消全选
    allIds.forEach(id => profileState.toggleSelection(id));
    document.querySelectorAll('.profile-card.selected').forEach(card => {
      card.classList.remove('selected');
    });
    document.querySelectorAll('.profile-checkbox:checked').forEach(cb => {
      cb.checked = false;
    });
  } else {
    // 全选
    allIds.filter(id => !selectedProfiles.has(id)).forEach(
      id => profileState.toggleSelection(id),
    );
    document.querySelectorAll('.profile-card').forEach(card => {
      card.classList.add('selected');
    });
    document.querySelectorAll('.profile-checkbox').forEach(cb => {
      cb.checked = true;
    });
  }

  updateSelectAllButton();
  updateLaunchSelectedButton();
  updateCloseSelectedButton();
}

// Keyboard shortcuts for bulk actions
document.addEventListener('keydown', (e) => {
  if (isEditableTarget(e.target)) return;
  // Cmd/Ctrl + A to select all
  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    e.preventDefault();
    toggleSelectVisibleProfiles();
  }

  // Space to launch selected when profiles are selected
  const snapshot = profileState.getSnapshot();
  const selectedProfiles = new Set(snapshot.selectedIds);
  if (e.key === ' ' && selectedProfiles.size > 0) {
    e.preventDefault();
    const runningBrowsers = new Set(snapshot.runningIds);
    const unknownBrowsers = new Set(snapshot.unknownIds);
    const retryableCloseBrowsers = new Set(snapshot.retryableCloseIds);
    const notRunningSelected = Array.from(selectedProfiles).filter(
      id => !runningBrowsers.has(id) && !unknownBrowsers.has(id),
    );
    const runningSelected = filterCloseableProfileIds(
      selectedProfiles,
      runningBrowsers,
      retryableCloseBrowsers,
    );

    if (notRunningSelected.length > 0) {
      document.getElementById('launchSelectedBtn').click();
    } else if (runningSelected.length > 0) {
      document.getElementById('closeSelectedBtn').click();
    }
  }
});

// Toggle profile selection - 只更新单个卡片，避免整体闪烁
function toggleProfileSelection(profileId) {
  const card = document.querySelector(`.profile-card[data-id="${profileId}"]`);
  const checkbox = document.querySelector(`.profile-checkbox[data-id="${profileId}"]`);

  if (!card || !checkbox) return;

  const isSelected = profileState.getSnapshot().selectedIds.includes(profileId);
  profileState.toggleSelection(profileId);
  if (isSelected) {
    card.classList.remove('selected');
    checkbox.checked = false;
  } else {
    card.classList.add('selected');
    checkbox.checked = true;
  }

  updateSelectAllButton();
  updateLaunchSelectedButton();
  updateCloseSelectedButton();
}

// Update select all button text
function updateSelectAllButton() {
  const selectAllBtn = document.getElementById('selectAllBtn');
  const selectedProfiles = new Set(profileState.getSnapshot().selectedIds);
  const visibleProfiles = getVisibleProfiles();
  if (selectAllBtn && visibleProfiles.length > 0) {
    const allSelected = visibleProfiles.every(p => selectedProfiles.has(p.id));
    selectAllBtn.textContent = allSelected ? '取消全选' : '全选';
  } else if (selectAllBtn) {
    selectAllBtn.textContent = '全选';
  }
}

// Update launch selected button
function updateLaunchSelectedButton() {
  const launchSelectedBtn = document.getElementById('launchSelectedBtn');
  const selectedCount = document.getElementById('selectedCount');

  if (launchSelectedBtn && selectedCount) {
    const snapshot = profileState.getSnapshot();
    const selectedProfiles = new Set(snapshot.selectedIds);
    const runningBrowsers = new Set(snapshot.runningIds);
    const unknownBrowsers = new Set(snapshot.unknownIds);
    const notRunningSelected = Array.from(selectedProfiles).filter(
      id => !runningBrowsers.has(id) && !unknownBrowsers.has(id),
    );

    if (notRunningSelected.length > 0) {
      launchSelectedBtn.style.display = 'block';
      selectedCount.textContent = notRunningSelected.length;
    } else {
      launchSelectedBtn.style.display = 'none';
    }
  }
}

// Update close selected button
function updateCloseSelectedButton() {
  const closeSelectedBtn = document.getElementById('closeSelectedBtn');
  const closeSelectedCount = document.getElementById('closeSelectedCount');

  if (closeSelectedBtn && closeSelectedCount) {
    const snapshot = profileState.getSnapshot();
    const selectedProfiles = new Set(snapshot.selectedIds);
    const runningBrowsers = new Set(snapshot.runningIds);
    const retryableCloseBrowsers = new Set(snapshot.retryableCloseIds);
    const runningSelected = filterCloseableProfileIds(
      selectedProfiles,
      runningBrowsers,
      retryableCloseBrowsers,
    );

    if (runningSelected.length > 0) {
      closeSelectedBtn.style.display = 'block';
      closeSelectedCount.textContent = runningSelected.length;
    } else {
      closeSelectedBtn.style.display = 'none';
    }
  }
}

// Initialize
void loadProfiles().catch((error) => {
  showToast(`加载配置失败：${error.message}`, 'error');
});

window.browserAPI.onBrowserStatusesChanged(() => {
  clearTimeout(statusRefreshTimer);
  statusRefreshTimer = setTimeout(() => {
    void refreshAllStatuses().catch(() => {});
  }, 100);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshAllStatuses().catch(() => {});
});

// View mode toggle
document.getElementById('viewListBtn')?.addEventListener('click', () => setViewMode('list'));
document.getElementById('viewGridBtn')?.addEventListener('click', () => setViewMode('grid'));

// Load view mode from localStorage (check settings default first)
function loadViewMode() {
  const savedMode = localStorage.getItem('viewMode');
  const defaultMode = localStorage.getItem('defaultViewMode');

  if (savedMode === 'grid' || savedMode === 'list') {
    currentViewMode = savedMode;
  } else if (defaultMode === 'grid' || defaultMode === 'list') {
    currentViewMode = defaultMode;
  } else {
    currentViewMode = 'list';
  }
  setViewMode(currentViewMode);
}

// Set view mode
function setViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem('viewMode', mode);

  const profilesList = document.getElementById('profilesList');
  const viewListBtn = document.getElementById('viewListBtn');
  const viewGridBtn = document.getElementById('viewGridBtn');

  if (mode === 'grid') {
    profilesList.classList.remove('view-list');
    profilesList.classList.add('view-grid');
    viewGridBtn.classList.add('active');
    viewListBtn.classList.remove('active');
  } else {
    profilesList.classList.remove('view-grid');
    profilesList.classList.add('view-list');
    viewListBtn.classList.add('active');
    viewGridBtn.classList.remove('active');
  }
}

// Load view mode on startup
loadViewMode();

// Search functionality
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      profileState.setQuery(e.target.value);
      renderProfiles();
    }, 150);
  });

  // Focus search with Cmd/Ctrl + F
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }

    // Escape to clear search
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      profileState.setQuery('');
      renderProfiles();
      searchInput.blur();
    }
  });
}

// Filter functionality
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    profileState.setFilter(btn.dataset.filter);
    renderProfiles();
  });
});

document.getElementById('exportProfilesBtn')?.addEventListener('click', async () => {
  try {
    const result = await window.browserAPI.exportProfiles();
    if (result.success) showToast(`已导出 ${result.count} 个配置`, 'success');
    else if (!result.canceled) showToast(`导出失败：${result.error}`, 'error');
  } catch (error) {
    showToast(`导出失败：${error.message}`, 'error');
  }
});

document.getElementById('importProfilesBtn')?.addEventListener('click', async () => {
  try {
    const result = await window.browserAPI.importProfiles();
    if (!result.success) {
      if (!result.canceled) showToast(`导入失败：${result.error}`, 'error');
      return;
    }
    const { profiles } = profileState.getSnapshot();
    profileState.setProfiles([...profiles, ...result.profiles]);
    renderProfiles();
    showToast(`已导入 ${result.profiles.length} 个配置，跳过 ${result.skipped} 个重复项`, 'success');
  } catch (error) {
    showToast(`导入失败：${error.message}`, 'error');
  }
});
