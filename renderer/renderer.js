// Render process logic

let profiles = [];
let currentRenameId = null;

// Load profiles on startup
async function loadProfiles() {
  profiles = await window.browserAPI.getProfiles();
  renderProfiles();
}

// Render profiles list
function renderProfiles() {
  const profilesList = document.getElementById('profilesList');

  if (profiles.length === 0) {
    profilesList.innerHTML = '<p class="empty-message">暂无配置，请在上方添加</p>';
    return;
  }

  profilesList.innerHTML = profiles.map(profile => `
    <div class="profile-card" data-id="${profile.id}">
      <div class="profile-info">
        <h3>${escapeHtml(profile.name)}</h3>
        <span class="browser-type">${profile.browserType}</span>
      </div>
      <div class="profile-actions">
        <button class="btn btn-success btn-small" onclick="launchBrowser('${profile.id}')">启动</button>
        <button class="btn btn-secondary btn-small" onclick="openProfileFolder('${profile.id}')">文件夹</button>
        <button class="btn btn-warning btn-small" onclick="renameProfile('${profile.id}', '${escapeHtml(profile.name)}')">重命名</button>
        <button class="btn btn-danger btn-small" onclick="deleteProfile('${profile.id}')">删除</button>
      </div>
    </div>
  `).join('');
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
    renderProfiles();
    document.getElementById('profileName').value = '';
    document.getElementById('addModal').classList.remove('show');
  } else {
    alert('错误: ' + result.error);
  }
});

// Delete profile
async function deleteProfile(profileId) {
  if (!confirm('确定要删除此配置吗？')) {
    return;
  }

  const result = await window.browserAPI.deleteProfile(profileId);

  if (result.success) {
    profiles = profiles.filter(p => p.id !== profileId);
    renderProfiles();
  } else {
    alert('错误: ' + result.error);
  }
}

// Launch browser
async function launchBrowser(profileId) {
  const result = await window.browserAPI.launchBrowser(profileId);

  if (!result.success) {
    alert('启动浏览器失败: ' + result.error);
  }
}

// Open profile folder
async function openProfileFolder(profileId) {
  const result = await window.browserAPI.openProfileFolder(profileId);

  if (!result.success) {
    alert('打开文件夹失败: ' + result.error);
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
    alert('错误: ' + result.error);
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

// Initialize
loadProfiles();