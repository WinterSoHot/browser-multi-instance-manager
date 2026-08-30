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

function setSettingsBusy(busy) {
  document.getElementById('saveSettings').disabled = busy;
  document.getElementById('resetSettings').disabled = busy;
}

function setAppSettingsBusy(busy) {
  document.getElementById('closeToTray').disabled = busy;
}

async function loadAppSettings() {
  const settings = await appSettingsController.load();
  document.getElementById('closeToTray').checked = settings.closeToTray;
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

  await loadAppSettings();

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

document.getElementById('closeToTray').addEventListener('change', async (event) => {
  const checkbox = event.currentTarget;
  const requestedValue = checkbox.checked;
  setAppSettingsBusy(true);
  const result = await appSettingsController.save({ closeToTray: requestedValue });
  checkbox.checked = result.settings.closeToTray;
  if (!result.success) {
    alert('保存托盘设置失败，请重试');
  }
  setAppSettingsBusy(false);
});

// Back to home
document.getElementById('backToHome').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// Initialize
void loadSettings().catch(() => {
  document.getElementById('browserSettingsList').innerHTML = '<p class="path-status invalid">加载失败，请重试</p>';
});
