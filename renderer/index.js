// Render process logic - Main page

let profiles = [];
let currentRenameId = null;
let runningBrowsers = new Set();
let statusCheckInterval = null;
let selectedProfiles = new Set();
let currentViewMode = 'list'; // 'list' or 'grid'
let currentFilter = 'all'; // 'all', 'chrome', 'firefox', 'edge', 'zen'
let searchQuery = ''; // Search query

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
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

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

  // Filter profiles based on current filter and search query
  let filteredProfiles = profiles.filter(profile => {
    const matchesFilter = currentFilter === 'all' || profile.browserType === currentFilter;
    const matchesSearch = searchQuery === '' ||
      profile.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  if (filteredProfiles.length === 0) {
    const hasActiveFilter = currentFilter !== 'all' || searchQuery !== '';
    profilesList.innerHTML = `<p class="empty-message">${hasActiveFilter ? '没有找到匹配的配置' : '暂无配置，请点击上方按钮添加'}</p>`;
    updateSelectAllButton();
    updateLaunchSelectedButton();
    updateCloseSelectedButton();
    return;
  }

  profilesList.innerHTML = filteredProfiles.map(profile => {
    const isRunning = runningBrowsers.has(profile.id);
    const btnClass = isRunning ? 'btn-danger' : 'btn-success';
    const btnText = isRunning ? '关闭' : '启动';
    const launchFunc = isRunning ? 'closeBrowserOnly' : 'launchBrowserOnly';
    const isSelected = selectedProfiles.has(profile.id);

    return `
    <div class="profile-card ${profile.browserType} ${isSelected ? 'selected' : ''}" data-id="${profile.id}">
      <div class="profile-info">
        <label class="checkbox-label">
          <input type="checkbox" class="profile-checkbox" data-id="${profile.id}" ${isSelected ? 'checked' : ''}>
          <span class="checkbox-custom"></span>
        </label>
        <h3>${escapeHtml(profile.name)}</h3>
        <span class="browser-type">
          ${getBrowserIcon(profile.browserType)}
          ${profile.browserType}
        </span>
      </div>
      <div class="profile-actions">
        <button class="btn ${btnClass} btn-small" onclick="${launchFunc}('${profile.id}')">${btnText}</button>
        <button class="btn btn-secondary btn-small" onclick="openProfileFolder('${profile.id}')">文件夹</button>
        <button class="btn btn-warning btn-small" onclick="renameProfile('${profile.id}', '${escapeHtml(profile.name)}')">重命名</button>
        <button class="btn btn-danger btn-small" onclick="deleteProfile('${profile.id}')">删除</button>
      </div>
      <div class="selected-badge">✓</div>
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
    showToast('请输入配置名称', 'warning');
    return;
  }

  const result = await window.browserAPI.addProfile(browserType, profileName);

  if (result.success) {
    profiles.push(result.profile);
    selectedProfiles.clear(); // Clear selection when adding new profile
    renderProfiles();
    document.getElementById('profileName').value = '';
    document.getElementById('addModal').classList.remove('show');
    showToast(`已新建配置 "${profileName}"`, 'success');
  } else {
    showToast('错误：' + result.error, 'error');
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
    showToast('配置已删除', 'success');
  } else {
    showToast('错误：' + result.error, 'error');
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
    showToast('浏览器已启动', 'success');
  } else {
    showToast('启动浏览器失败：' + result.error, 'error');
  }
}

// Close browser
async function closeBrowserOnly(profileId) {
  const result = await window.browserAPI.closeBrowser(profileId);
  if (result.success) {
    runningBrowsers.delete(profileId);
    renderProfiles();
    showToast('浏览器已关闭', 'success');
  } else {
    showToast('关闭浏览器失败：' + result.error, 'error');
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
    showToast('打开文件夹失败：' + result.error, 'error');
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
    showToast('请输入名称', 'warning');
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
    showToast('请先选择要启动的配置', 'warning');
    return;
  }

  const toLaunch = Array.from(selectedProfiles).filter(id => !runningBrowsers.has(id));

  if (toLaunch.length === 0) {
    showToast('已选中的配置都已启动', 'info');
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
  showToast(`已启动 ${toLaunch.length} 个浏览器`, 'success');
});

// Close selected profiles
document.getElementById('closeSelectedBtn').addEventListener('click', async () => {
  if (selectedProfiles.size === 0) {
    showToast('请先选择要关闭的配置', 'warning');
    return;
  }

  const toClose = Array.from(selectedProfiles).filter(id => runningBrowsers.has(id));

  if (toClose.length === 0) {
    showToast('已选中的配置都已关闭', 'info');
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
  showToast(`已关闭 ${toClose.length} 个浏览器`, 'success');
});

// Select all profiles - 只更新必要的 DOM，避免整体闪烁
document.getElementById('selectAllBtn').addEventListener('click', () => {
  const allIds = profiles.map(p => p.id);
  const allSelected = allIds.every(id => selectedProfiles.has(id));

  if (allSelected) {
    // 取消全选
    selectedProfiles.clear();
    document.querySelectorAll('.profile-card.selected').forEach(card => {
      card.classList.remove('selected');
    });
    document.querySelectorAll('.profile-checkbox:checked').forEach(cb => {
      cb.checked = false;
    });
  } else {
    // 全选
    allIds.forEach(id => selectedProfiles.add(id));
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
});

// Keyboard shortcuts for bulk actions
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + A to select all
  if ((e.metaKey || e.ctrlKey) && e.key === 'a' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    const allIds = profiles.map(p => p.id);
    const allSelected = allIds.every(id => selectedProfiles.has(id));

    if (allSelected) {
      // 取消全选
      selectedProfiles.clear();
      document.querySelectorAll('.profile-card.selected').forEach(card => {
        card.classList.remove('selected');
      });
      document.querySelectorAll('.profile-checkbox:checked').forEach(cb => {
        cb.checked = false;
      });
    } else {
      // 全选
      allIds.forEach(id => selectedProfiles.add(id));
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

  // Space to launch selected when profiles are selected
  if (e.key === ' ' && document.activeElement.tagName !== 'INPUT' && selectedProfiles.size > 0) {
    e.preventDefault();
    const notRunningSelected = Array.from(selectedProfiles).filter(id => !runningBrowsers.has(id));
    const runningSelected = Array.from(selectedProfiles).filter(id => runningBrowsers.has(id));

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

  if (selectedProfiles.has(profileId)) {
    selectedProfiles.delete(profileId);
    card.classList.remove('selected');
    checkbox.checked = false;
  } else {
    selectedProfiles.add(profileId);
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

// Search functionality
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderProfiles();
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
      searchQuery = '';
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
    currentFilter = btn.dataset.filter;
    renderProfiles();
  });
});
