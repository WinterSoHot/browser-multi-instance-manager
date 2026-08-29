const { spawn } = require('node:child_process');

const PROCESS_VERIFIED = 'verified';
const PROCESS_MISMATCH = 'mismatch';
const PROCESS_UNAVAILABLE = 'unavailable';

function normalizeVerificationResult(result) {
  if (result === true || result === PROCESS_VERIFIED) return PROCESS_VERIFIED;
  if (result === false || result === PROCESS_MISMATCH) return PROCESS_MISMATCH;
  return PROCESS_UNAVAILABLE;
}

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

function isPersistedRecord(record) {
  return Boolean(
    record
    && typeof record.profileId === 'string'
    && record.profileId.length > 0
    && typeof record.browserType === 'string'
    && typeof record.profilePath === 'string'
    && typeof record.executablePath === 'string'
    && Number.isSafeInteger(record.pid)
    && record.pid > 0,
  );
}

function toPersistedRecord(record) {
  return {
    profileId: record.profileId,
    browserType: record.browserType,
    profilePath: record.profilePath,
    executablePath: record.executablePath,
    pid: record.pid,
  };
}

class BrowserProcessManager {
  constructor({
    spawnProcess = spawn,
    closeTimeoutMs = 5000,
    pollIntervalMs = 100,
    verificationCacheMs = 4000,
    now = Date.now,
    verifyProcess = async () => false,
    terminateProcess = (pid, signal) => process.kill(pid, signal),
    onStateChange = () => {},
  } = {}) {
    this.spawnProcess = spawnProcess;
    this.closeTimeoutMs = closeTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.verificationCacheMs = verificationCacheMs;
    this.now = now;
    this.verifyProcess = verifyProcess;
    this.terminateProcess = terminateProcess;
    this.onStateChange = onStateChange;
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
        this.processes.set(profileId, {
          profileId,
          browserType,
          profilePath,
          executablePath,
          pid: child.pid,
          child,
        });
        this.pendingProfiles.delete(profileId);
        child.unref();
        this.notifyStateChange();
        finish({ success: true, pid: child.pid });
      });

      child.once('error', (error) => {
        this.pendingProfiles.delete(profileId);
        if (this.processes.get(profileId)?.child === child) {
          this.processes.delete(profileId);
          this.notifyStateChange();
        }
        finish({ success: false, error: error.message });
      });

      child.once('exit', () => {
        this.pendingProfiles.delete(profileId);
        if (this.processes.get(profileId)?.child === child) {
          this.processes.delete(profileId);
          this.notifyStateChange();
        }
      });
    });
  }

  async restore(records) {
    const candidates = Array.isArray(records) ? records.filter(isPersistedRecord) : [];
    const verified = await Promise.all(candidates.map(async (record) => {
      try {
        const verificationResult = normalizeVerificationResult(
          await this.verifyProcess(toPersistedRecord(record)),
        );
        if (verificationResult === PROCESS_MISMATCH) return null;
        return {
          ...toPersistedRecord(record),
          child: null,
          lastVerifiedAt: verificationResult === PROCESS_VERIFIED ? this.now() : undefined,
          verificationPromise: null,
        };
      } catch {
        return null;
      }
    }));

    this.processes.clear();
    for (const record of verified) {
      if (record && !this.processes.has(record.profileId)) {
        this.processes.set(record.profileId, record);
      }
    }
    this.notifyStateChange();
    return [...this.processes.keys()];
  }

  close(profileId) {
    if (this.pendingProfiles.has(profileId)) {
      return Promise.resolve({ success: false, error: 'Browser is still starting' });
    }

    const record = this.processes.get(profileId);
    if (!record) {
      return Promise.resolve({ success: false, error: 'Browser not running' });
    }
    if (!record.child) {
      return this.closeRecoveredProcess(profileId, record);
    }

    const child = record.child;
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

  async closeRecoveredProcess(profileId, record) {
    const initialVerification = await this.getRecordVerification(record, { force: true });
    if (initialVerification === PROCESS_MISMATCH) {
      if (this.processes.get(profileId) === record) {
        this.processes.delete(profileId);
        this.notifyStateChange();
      }
      return { success: false, error: 'Browser not running' };
    }
    if (initialVerification === PROCESS_UNAVAILABLE) {
      return { success: false, error: 'Unable to verify browser process' };
    }

    try {
      if (this.terminateProcess(record.pid, 'SIGTERM') === false) {
        return { success: false, error: 'Failed to signal browser process' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }

    const deadline = Date.now() + this.closeTimeoutMs;
    while (true) {
      const verification = await this.getRecordVerification(record, { force: true });
      if (verification === PROCESS_MISMATCH) {
        if (this.processes.get(profileId) === record) {
          this.processes.delete(profileId);
          this.notifyStateChange();
        }
        return { success: true };
      }
      if (Date.now() >= deadline) {
        return { success: false, error: 'Timed out waiting for browser to close' };
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  isRunning(profileId) {
    if (this.pendingProfiles.has(profileId)) {
      return true;
    }
    const record = this.processes.get(profileId);
    return Boolean(record && (!record.child || record.child.exitCode === null));
  }

  async getStatus(profileId, { force = false } = {}) {
    if (this.pendingProfiles.has(profileId)) {
      return { running: true };
    }
    const record = this.processes.get(profileId);
    if (!record) {
      return { running: false };
    }
    if (record.child) {
      return { running: record.child.exitCode === null };
    }

    const verification = await this.getRecordVerification(record, { force });
    if (verification === PROCESS_MISMATCH && this.processes.get(profileId) === record) {
      this.processes.delete(profileId);
      this.notifyStateChange();
    }
    if (verification === PROCESS_UNAVAILABLE) {
      return { running: true, verificationUnavailable: true };
    }
    return {
      running: verification === PROCESS_VERIFIED && this.processes.get(profileId) === record,
    };
  }

  async getRecordVerification(record, { force = false } = {}) {
    if (
      !force
      && record.lastVerifiedAt !== undefined
      && this.now() - record.lastVerifiedAt < this.verificationCacheMs
    ) {
      return PROCESS_VERIFIED;
    }
    if (record.verificationPromise) {
      return record.verificationPromise;
    }

    record.verificationPromise = (async () => {
      try {
        const result = normalizeVerificationResult(
          await this.verifyProcess(toPersistedRecord(record)),
        );
        if (result === PROCESS_VERIFIED) record.lastVerifiedAt = this.now();
        return result;
      } catch {
        return PROCESS_UNAVAILABLE;
      } finally {
        record.verificationPromise = null;
      }
    })();
    return record.verificationPromise;
  }

  getPersistedRecords() {
    return [...this.processes.values()].map(toPersistedRecord);
  }

  notifyStateChange() {
    this.onStateChange(this.getPersistedRecords());
  }
}

module.exports = {
  BrowserProcessManager,
  buildBrowserArgs,
};
