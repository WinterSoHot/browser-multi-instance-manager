const { spawn } = require('node:child_process');

function buildBrowserArgs(browserType, profilePath) {
  switch (browserType) {
    case 'chrome':
    case 'edge':
      return [`--user-data-dir=${profilePath}`];
    case 'firefox':
    case 'zen':
      return ['-no-remote', '-profile', profilePath];
    default:
      throw new Error('Unsupported browser type');
  }
}

class BrowserProcessManager {
  constructor({ spawnProcess = spawn, closeTimeoutMs = 5000 } = {}) {
    this.spawnProcess = spawnProcess;
    this.closeTimeoutMs = closeTimeoutMs;
    this.processes = new Map();
    this.pendingProfiles = new Set();
  }

  launch({ profileId, browserType, profilePath, executablePath }) {
    if (this.isRunning(profileId)) {
      return Promise.resolve({ success: false, error: 'Browser already running' });
    }

    let args;
    try {
      args = buildBrowserArgs(browserType, profilePath);
    } catch (error) {
      return Promise.resolve({ success: false, error: error.message });
    }

    this.pendingProfiles.add(profileId);

    return new Promise((resolve) => {
      let child;
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        child = this.spawnProcess(executablePath, args, {
          detached: true,
          stdio: 'ignore',
        });
      } catch (error) {
        this.pendingProfiles.delete(profileId);
        finish({ success: false, error: error.message });
        return;
      }

      child.once('spawn', () => {
        this.processes.set(profileId, child);
        this.pendingProfiles.delete(profileId);
        child.unref();
        finish({ success: true, pid: child.pid });
      });

      child.once('error', (error) => {
        this.pendingProfiles.delete(profileId);
        if (this.processes.get(profileId) === child) {
          this.processes.delete(profileId);
        }
        finish({ success: false, error: error.message });
      });

      child.once('exit', () => {
        this.pendingProfiles.delete(profileId);
        if (this.processes.get(profileId) === child) {
          this.processes.delete(profileId);
        }
      });
    });
  }

  close(profileId) {
    if (this.pendingProfiles.has(profileId)) {
      return Promise.resolve({ success: false, error: 'Browser is still starting' });
    }

    const child = this.processes.get(profileId);
    if (!child) {
      return Promise.resolve({ success: false, error: 'Browser not running' });
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        finish({ success: false, error: 'Timed out waiting for browser to close' });
      }, this.closeTimeoutMs);
      timeout.unref?.();

      child.once('exit', () => finish({ success: true }));
      child.once('error', (error) => finish({ success: false, error: error.message }));

      try {
        if (!child.kill('SIGTERM')) {
          finish({ success: false, error: 'Failed to signal browser process' });
        }
      } catch (error) {
        finish({ success: false, error: error.message });
      }
    });
  }

  isRunning(profileId) {
    if (this.pendingProfiles.has(profileId)) {
      return true;
    }
    const child = this.processes.get(profileId);
    return Boolean(child && child.exitCode === null);
  }

  getStatus(profileId) {
    return { running: this.isRunning(profileId) };
  }
}

module.exports = {
  BrowserProcessManager,
  buildBrowserArgs,
};
