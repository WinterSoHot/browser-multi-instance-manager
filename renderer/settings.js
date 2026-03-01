// Settings page logic

const browserNames = {
  chrome: 'Google Chrome',
  firefox: 'Firefox',
  edge: 'Microsoft Edge',
  zen: 'Zen Browser'
};

let customSettings = {};
let defaultPaths = {};
let currentPlatform = '';

// Load settings on startup
async function loadSettings() {
  // Get platform info
  currentPlatform = await window.browserAPI.getPlatform();
  const platformText = currentPlatform === 'win32' ? 'Windows' : (currentPlatform === 'darwin' ? 'macOS' : currentPlatform);
  document.getElementById('platformInfo').textContent = `当前平台: ${platformText}`;

  // Load custom settings
  customSettings = await window.browserAPI.getBrowserSettings();

  // Load default paths for each browser
  for (const browserType of Object.keys(browserNames)) {
    defaultPaths[browserType] = await window.browserAPI.getDefaultBrowserPath(browserType);
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
          ${defaultPath ? `<div class="default-path">默认路径: ${escapeHtml(defaultPath)}</div>` : ''}
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
      const result = await window.browserAPI.browseFolder(currentPath);

      if (result.success && result.path) {
        document.getElementById(`path-${browserType}`).value = result.path;
      }
    });
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Save settings
document.getElementById('saveSettings').addEventListener('click', async () => {
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
    // If value equals default, we can either save it or leave it empty
    // Let's save empty to indicate using default
  }

  await window.browserAPI.setBrowserSettings(newSettings);
  alert('设置已保存');
  customSettings = newSettings;
  renderBrowserSettings();
});

// Reset to default
document.getElementById('resetSettings').addEventListener('click', async () => {
  if (!confirm('确定要重置所有浏览器路径为默认吗？')) {
    return;
  }

  await window.browserAPI.setBrowserSettings({});
  customSettings = {};
  renderBrowserSettings();
  alert('已重置为默认路径');
});

// Back to home
document.getElementById('backToHome').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// Initialize
loadSettings();