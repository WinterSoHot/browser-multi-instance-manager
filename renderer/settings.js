// Settings page logic

const { escapeHtml } = window.viewUtils;

const browserNames = {
  chrome: 'Google Chrome',
  firefox: 'Firefox',
  edge: 'Microsoft Edge',
  zen: 'Zen Browser'
};

let customSettings = {};
let defaultPaths = {};
let currentPlatform = '';
let browserValidity = {};
const appSettingsController = window.createAppSettingsController({
  getAppSettings: () => window.browserAPI.getAppSettings(),
  setAppSettings: (settings) => window.browserAPI.setAppSettings(settings),
});
const closeToTrayBinding = window.bindCloseToTrayCheckbox({
  checkbox: document.getElementById('closeToTray'),
  controller: appSettingsController,
  showError: () => alert('保存托盘设置失败，请重试'),
});
const updateCheckbox = document.getElementById('checkUpdatesOnStartup');
const updateButton = document.getElementById('checkForUpdates');
const updateStatus = document.getElementById('updateStatus');
const openReleaseButton = document.getElementById('openReleasePage');
let updateSettingLoaded = false;
let updateController;
const updateSettingBinding = window.bindUpdateSettingsCheckbox({
  checkbox: updateCheckbox,
  getAppSettings: () => window.browserAPI.getAppSettings(),
  setAppSettings: (settings) => window.browserAPI.setAppSettings(settings),
  showError: () => alert('保存更新设置失败，请重试'),
});

function setUpdateStatus(result) {
  const update = result?.status === 'cached' ? result.result : result;
  const cachedPrefix = result?.status === 'cached' ? '已使用最近结果，' : '';
  if (update?.status === 'available') updateStatus.textContent = `${cachedPrefix}发现新版本 ${update.version}`;
  else if (update?.status === 'current') updateStatus.textContent = `${cachedPrefix}当前已是最新版本`;
  else if (update?.status === 'error') updateStatus.textContent = '检查更新失败，请稍后重试';
  else updateStatus.textContent = '';
}

function renderUpdate(state) {
  updateButton.disabled = state.busy || !updateSettingLoaded;
  setUpdateStatus(state.result);
  openReleaseButton.hidden = !state.available;
}

async function loadUpdateSettings() {
  await updateSettingBinding.load();
  updateSettingLoaded = true;
  if (updateController) renderUpdate({ busy: updateController.isBusy() });
}

async function loadUpdateVersion() {
  let version = '未知';
  try {
    const received = await window.browserAPI.getAppVersion();
    if (typeof received === 'string') version = received;
  } catch {
    // Keep the stable display fallback.
  }
  document.getElementById('appVersion').textContent = version;
  updateController = window.createUpdateUiController({
    currentVersion: version,
    checkForUpdates: (force) => window.browserAPI.checkForUpdates(force),
    openReleasePage: (releaseUrl) => window.browserAPI.openReleasePage(releaseUrl),
    render: renderUpdate,
  });
  renderUpdate({ busy: false });
}

updateButton.addEventListener('click', () => {
  if (updateController && !updateController.isBusy()) void updateController.check(true);
});
openReleaseButton.addEventListener('click', async () => {
  if (!updateController) return;
  const result = await updateController.openAvailable();
  if (!result.success) alert('无法打开下载页面，请稍后重试');
});

function setSettingsBusy(busy) {
  document.getElementById('saveSettings').disabled = busy;
  document.getElementById('resetSettings').disabled = busy;
}

async function loadAppSettings() {
  try {
    const settings = await appSettingsController.load();
    document.getElementById('closeToTray').checked = settings.closeToTray;
  } finally {
    closeToTrayBinding.sync();
  }
}

// Load settings on startup
async function loadSettings() {
  const environment = await window.browserAPI.getBrowserEnvironment();
  currentPlatform = environment.platform;
  const platformText = currentPlatform === 'win32' ? 'Windows' : (currentPlatform === 'darwin' ? 'macOS' : currentPlatform);
  document.getElementById('platformInfo').textContent = `当前平台: ${platformText}`;

  customSettings = environment.settings;
  defaultPaths = environment.defaultPaths;
  browserValidity = environment.validity;

  // Load default view mode
  const savedViewMode = localStorage.getItem('defaultViewMode');
  if (savedViewMode) {
    document.getElementById('defaultViewMode').value = savedViewMode;
  }

  renderBrowserSettings();
}

// Render browser settings list
function renderBrowserSettings() {
  const container = document.getElementById('browserSettingsList');

  const html = Object.entries(browserNames).map(([browserType, browserName]) => {
    const customPath = customSettings[browserType] || '';
    const defaultPath = defaultPaths[browserType] || '';
    const displayPath = customPath || defaultPath;

    return `
      <div class="browser-setting-item">
        <div class="browser-setting-header">
          <span class="browser-name">${browserName}</span>
          <span class="browser-type-label">${browserType}</span>
        </div>
        <div class="browser-setting-path">
          <label>可执行文件路径:</label>
          <div class="path-input-group">
            <input type="text"
                   id="path-${browserType}"
                   value="${escapeHtml(displayPath)}"
                   placeholder="${escapeHtml(defaultPath) || '留空使用默认路径'}"
                   data-browser-type="${browserType}">
            <button class="btn btn-secondary btn-small browse-btn" data-browser-type="${browserType}">浏览</button>
          </div>
          ${defaultPath ? `<div class="default-path">自动检测: ${escapeHtml(defaultPath)}</div>` : '<div class="path-status invalid">未自动检测到安装位置</div>'}
          <div class="path-status ${browserValidity[browserType] ? 'valid' : 'invalid'}">${browserValidity[browserType] ? '路径可用' : '路径不可用'}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;

  // Add event listeners for browse buttons
  document.querySelectorAll('.browse-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const browserType = btn.dataset.browserType;
      const currentPath = document.getElementById(`path-${browserType}`).value;
      btn.disabled = true;
      try {
        const result = await window.browserAPI.browseFolder(currentPath);
        if (result.success && result.path) {
          document.getElementById(`path-${browserType}`).value = result.path;
        }
      } catch {
        alert('选择路径失败，请重试');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// Save settings
document.getElementById('saveSettings').addEventListener('click', async () => {
  setSettingsBusy(true);
  try {
    const newSettings = {};

    for (const browserType of Object.keys(browserNames)) {
      const input = document.getElementById(`path-${browserType}`);
      const value = input.value.trim();

      // Only save if user explicitly entered a value (not placeholder)
      if (value && value !== defaultPaths[browserType]) {
        newSettings[browserType] = value;
      } else if (value === '') {
        // User cleared the field - use default
        newSettings[browserType] = '';
      }
      // If value equals default, leave it empty to keep automatic detection enabled.
    }

    const result = await window.browserAPI.setBrowserSettings(newSettings);
    if (!result.success) {
      alert(`保存设置失败：${result.error}`);
      return;
    }

    const viewMode = document.getElementById('defaultViewMode').value;
    localStorage.setItem('defaultViewMode', viewMode);

    alert('设置已保存');
    await loadSettings();
  } catch {
    alert('保存设置失败，请重试');
  } finally {
    setSettingsBusy(false);
  }
});

// Reset to default
document.getElementById('resetSettings').addEventListener('click', async () => {
  if (!confirm('确定要重置所有浏览器路径为默认吗？')) {
    return;
  }

  setSettingsBusy(true);
  try {
    const result = await window.browserAPI.setBrowserSettings({});
    if (!result.success) {
      alert(`重置设置失败：${result.error}`);
      return;
    }
    await loadSettings();
    alert('已重置为默认路径');
  } catch {
    alert('重置设置失败，请重试');
  } finally {
    setSettingsBusy(false);
  }
});

// Back to home
document.getElementById('backToHome').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// Initialize
void loadAppSettings();
void loadUpdateSettings();
void loadUpdateVersion();
void loadSettings().catch(() => {
  document.getElementById('browserSettingsList').innerHTML = '<p class="path-status invalid">加载失败，请重试</p>';
});
