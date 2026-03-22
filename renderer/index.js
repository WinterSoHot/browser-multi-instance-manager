// Render process logic - Main page

let profiles = [];
let currentRenameId = null;
let runningBrowsers = new Set();
let statusCheckInterval = null;
let selectedProfiles = new Set();
let currentViewMode = 'list'; // 'list' or 'grid'

// Load profiles on startup
async function loadProfiles() {
  profiles = await window.browserAPI.getProfiles();
  renderProfiles();

  // Start polling browser status
  startStatusPolling();
}

// Poll browser status every 2 seconds
function startStatusPolling() {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }

  statusCheckInterval = setInterval(async () => {
    if (runningBrowsers.size === 0) return;

    const toRemove = [];
    for (const profileId of runningBrowsers) {
      const status = await window.browserAPI.getBrowserStatus(profileId);
      if (!status.running) {
        toRemove.push(profileId);
      }
    }

    if (toRemove.length > 0) {
      toRemove.forEach(id => runningBrowsers.delete(id));
      renderProfiles();
    }
  }, 2000);
}

// Render profiles list
function renderProfiles() {
  const profilesList = document.getElementById('profilesList');

  if (profiles.length === 0) {
    profilesList.innerHTML = '<p class="empty-message">暂无配置，请在上方添加</p>';
    updateSelectAllButton();
    updateLaunchSelectedButton();
    updateCloseSelectedButton();
    return;
  }

  profilesList.innerHTML = profiles.map(profile => {
    const isRunning = runningBrowsers.has(profile.id);
    const btnClass = isRunning ? 'btn-danger' : 'btn-success';
    const btnText = isRunning ? '关闭' : '启动';
    const launchFunc = isRunning ? 'closeBrowserOnly' : 'launchBrowserOnly';
    const isSelected = selectedProfiles.has(profile.id);

    return `
    <div class="profile-card ${isSelected ? 'selected' : ''}" data-id="${profile.id}">
      <div class="profile-info">
        <label class="checkbox-label">
          <input type="checkbox" class="profile-checkbox" data-id="${profile.id}" ${isSelected ? 'checked' : ''}>
          <span class="checkbox-custom"></span>
        </label>
        <h3>${escapeHtml(profile.name)}</h3>
        <span class="browser-type">${profile.browserType}</span>
      </div>
      <div class="profile-actions">
        <button class="btn ${btnClass} btn-small" onclick="${launchFunc}('${profile.id}')">${btnText}</button>
        <button class="btn btn-secondary btn-small" onclick="openProfileFolder('${profile.id}')">文件夹</button>
        <button class="btn btn-warning btn-small" onclick="renameProfile('${profile.id}', '${escapeHtml(profile.name)}')">重命名</button>
        <button class="btn btn-danger btn-small" onclick="deleteProfile('${profile.id}')">删除</button>
      </div>
    </div>
  `}).join('');

  // Add event listeners to checkboxes
  document.querySelectorAll('.profile-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleProfileSelection(e.target.dataset.id);
    });
  });

  document.querySelectorAll('.profile-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't toggle selection when clicking on buttons or checkbox
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.checkbox-label')) {
        return;
      }
      const profileId = card.dataset.id;
      toggleProfileSelection(profileId);
    });
  });

  updateSelectAllButton();
  updateLaunchSelectedButton();
  updateCloseSelectedButton();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add new profile
document.getElementById('addProfileForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const browserType = document.getElementById('browserType').value;
  const profileName = document.getElementById('profileName').value.trim();

  if (!profileName) {
    return;
  }

  const result = await window.browserAPI.addProfile(browserType, profileName);

  if (result.success) {
    profiles.push(result.profile);
    selectedProfiles.clear(); // Clear selection when adding new profile
    renderProfiles();
    document.getElementById('profileName').value = '';
    document.getElementById('addModal').classList.remove('show');
  } else {
    alert('错误：' + result.error);
  }
});

// Delete profile
async function deleteProfile(profileId) {
  if (!confirm('确定要删除此配置吗？')) {
    return;
  }

  // If browser is running, close it first
  if (runningBrowsers.has(profileId)) {
    await window.browserAPI.closeBrowser(profileId);
    runningBrowsers.delete(profileId);
  }

  // Remove from selection if selected
  selectedProfiles.delete(profileId);

  const result = await window.browserAPI.deleteProfile(profileId);

  if (result.success) {
    profiles = profiles.filter(p => p.id !== profileId);
    renderProfiles();
  } else {
    alert('错误：' + result.error);
  }
}

// Toggle browser (launch or close) - deprecated
async function toggleBrowser(profileId) {
  if (runningBrowsers.has(profileId)) {
    const result = await window.browserAPI.closeBrowser(profileId);
    if (result.success) {
      runningBrowsers.delete(profileId);
      renderProfiles();
    } else {
      alert('关闭浏览器失败：' + result.error);
    }
  } else {
    const result = await window.browserAPI.launchBrowser(profileId);
    if (result.success) {
      runningBrowsers.add(profileId);
      renderProfiles();
    } else {
      alert('启动浏览器失败：' + result.error);
    }
  }
}

// Launch browser only (supports multiple instances)
async function launchBrowserOnly(profileId) {
  const result = await window.browserAPI.launchBrowser(profileId);
  if (result.success) {
    runningBrowsers.add(profileId);
    renderProfiles();
  } else {
    alert('启动浏览器失败：' + result.error);
  }
}

// Close browser
async function closeBrowserOnly(profileId) {
  const result = await window.browserAPI.closeBrowser(profileId);
  if (result.success) {
    runningBrowsers.delete(profileId);
    renderProfiles();
  } else {
    alert('关闭浏览器失败：' + result.error);
  }
}

// Launch browser (legacy function)
async function launchBrowser(profileId) {
  await toggleBrowser(profileId);
}

// Open profile folder
async function openProfileFolder(profileId) {
  const result = await window.browserAPI.openProfileFolder(profileId);

  if (!result.success) {
    alert('打开文件夹失败：' + result.error);
  }
}

// Rename profile
async function renameProfile(profileId, currentName) {
  currentRenameId = profileId;
  document.getElementById('newProfileName').value = currentName;
  document.getElementById('renameModal').classList.add('show');
  document.getElementById('newProfileName').focus();
}

// Modal event handlers
document.getElementById('confirmRename').addEventListener('click', async () => {
  const newName = document.getElementById('newProfileName').value.trim();

  if (!newName) {
    alert('请输入名称');
    return;
  }

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
    renderProfiles();
    closeModal();
  } else {
    alert('错误：' + result.error);
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
  if (e.key === 'Enter') {
    document.getElementById('addProfileForm').dispatchEvent(new Event('submit'));
  } else if (e.key === 'Escape') {
    document.getElementById('addModal').classList.remove('show');
  }
});

// Settings button handler
document.getElementById('openSettings').addEventListener('click', () => {
  window.location.href = 'settings.html';
});

// Launch selected profiles
document.getElementById('launchSelectedBtn').addEventListener('click', async () => {
  if (selectedProfiles.size === 0) {
    alert('请先选择要启动的配置');
    return;
  }

  const toLaunch = Array.from(selectedProfiles).filter(id => !runningBrowsers.has(id));

  if (toLaunch.length === 0) {
    alert('已选中的配置都已启动');
    return;
  }

  // Launch all selected browsers concurrently
  await Promise.all(toLaunch.map(async (profileId) => {
    const result = await window.browserAPI.launchBrowser(profileId);
    if (result.success) {
      runningBrowsers.add(profileId);
    }
  }));

  // Clear selection after launch
  selectedProfiles.clear();
  renderProfiles();
});

// Close selected profiles
document.getElementById('closeSelectedBtn').addEventListener('click', async () => {
  if (selectedProfiles.size === 0) {
    alert('请先选择要关闭的配置');
    return;
  }

  const toClose = Array.from(selectedProfiles).filter(id => runningBrowsers.has(id));

  if (toClose.length === 0) {
    alert('已选中的配置都已关闭');
    return;
  }

  // Close all selected browsers concurrently
  await Promise.all(toClose.map(async (profileId) => {
    const result = await window.browserAPI.closeBrowser(profileId);
    if (result.success) {
      runningBrowsers.delete(profileId);
    }
  }));

  // Clear selection after close
  selectedProfiles.clear();
  renderProfiles();
});

// Select all profiles
document.getElementById('selectAllBtn').addEventListener('click', () => {
  const allIds = profiles.map(p => p.id);
  const allSelected = allIds.every(id => selectedProfiles.has(id));

  if (allSelected) {
    selectedProfiles.clear();
  } else {
    allIds.forEach(id => selectedProfiles.add(id));
  }
  renderProfiles();
});

// Toggle profile selection
function toggleProfileSelection(profileId) {
  if (selectedProfiles.has(profileId)) {
    selectedProfiles.delete(profileId);
  } else {
    selectedProfiles.add(profileId);
  }
  renderProfiles();
}

// Update select all button text
function updateSelectAllButton() {
  const selectAllBtn = document.getElementById('selectAllBtn');
  if (selectAllBtn && profiles.length > 0) {
    const allSelected = profiles.every(p => selectedProfiles.has(p.id));
    selectAllBtn.textContent = allSelected ? '取消全选' : '全选';
  }
}

// Update launch selected button
function updateLaunchSelectedButton() {
  const launchSelectedBtn = document.getElementById('launchSelectedBtn');
  const selectedCount = document.getElementById('selectedCount');

  if (launchSelectedBtn && selectedCount) {
    const notRunningSelected = Array.from(selectedProfiles).filter(id => !runningBrowsers.has(id));

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
    const runningSelected = Array.from(selectedProfiles).filter(id => runningBrowsers.has(id));

    if (runningSelected.length > 0) {
      closeSelectedBtn.style.display = 'block';
      closeSelectedCount.textContent = runningSelected.length;
    } else {
      closeSelectedBtn.style.display = 'none';
    }
  }
}

// Initialize
loadProfiles();

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
