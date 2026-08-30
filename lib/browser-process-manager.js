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

function hasUncertainTermination(record) {
  return Object.prototype.hasOwnProperty.call(record, 'terminationUncertain')
    && record.terminationUncertain !== false;
}

class BrowserProcessManager {
  constructor({
    spawnProcess = spawn,
    closeTimeoutMs = 5000,
    pollIntervalMs = 100,
    verificationCacheMs = 4000,
    now = Date.now,
    verifyProcess = async () => false,
    verifyProcesses = null,
    terminateProcess = (pid, signal) => process.kill(pid, signal),
    terminateLaunchedProcess = (record) => record.child.kill('SIGTERM'),
    onStateChange = () => {},
  } = {}) {
    this.spawnProcess = spawnProcess;
    this.closeTimeoutMs = closeTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.verificationCacheMs = verificationCacheMs;
    this.now = now;
    this.verifyProcess = verifyProcess;
    this.verifyProcesses = verifyProcesses;
    this.terminateProcess = terminateProcess;
    this.terminateLaunchedProcess = terminateLaunchedProcess;
    this.onStateChange = onStateChange;
    this.processes = new Map();
    this.pendingProfiles = new Set();
    this.closingProfiles = new Map();
    this.uncertainProfiles = new Map();
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
    const uncertainCandidates = candidates.filter(hasUncertainTermination);
    const verifiableCandidates = candidates.filter((record) => !hasUncertainTermination(record));
    let bulkVerifications = null;
    if (this.verifyProcesses && verifiableCandidates.length > 0) {
      try {
        bulkVerifications = await this.verifyProcesses(
          verifiableCandidates.map(toPersistedRecord),
        );
      } catch {
        bulkVerifications = {};
      }
    }
    const verified = await Promise.all(verifiableCandidates.map(async (record) => {
      try {
        const verificationResult = normalizeVerificationResult(
          bulkVerifications
            ? bulkVerifications[record.profileId]
            : await this.verifyProcess(toPersistedRecord(record)),
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
    this.uncertainProfiles.clear();
    for (const record of verified) {
      if (record && !this.processes.has(record.profileId)) {
        this.processes.set(record.profileId, record);
      }
    }
    for (const record of uncertainCandidates) {
      if (
        !this.processes.has(record.profileId)
        && !this.uncertainProfiles.has(record.profileId)
      ) {
        this.uncertainProfiles.set(record.profileId, {
          ...toPersistedRecord(record),
          child: null,
          terminationUncertain: true,
        });
      }
    }
    this.notifyStateChange();
    const restoredIds = new Set([
      ...this.processes.keys(),
      ...this.uncertainProfiles.keys(),
    ]);
    return candidates
      .map((record) => record.profileId)
      .filter((profileId, index, ids) => (
        restoredIds.has(profileId) && ids.indexOf(profileId) === index
      ));
  }

  close(profileId) {
    const activeClose = this.closingProfiles.get(profileId);
    if (activeClose) return activeClose;

    if (this.pendingProfiles.has(profileId)) {
      return Promise.resolve({ success: false, error: 'Browser is still starting' });
    }

    const record = this.processes.get(profileId) || this.uncertainProfiles.get(profileId);
    if (!record) {
      return Promise.resolve({ success: false, error: 'Browser not running' });
    }

    let operation;
    if (record.child) {
      this.markTerminationUncertain(profileId, record);
      operation = this.closeLaunchedProcess(profileId, record);
    } else {
      operation = this.performRecoveredProcessClose(profileId, record);
    }
    const current = operation.finally(() => {
      if (this.closingProfiles.get(profileId) === current) {
        this.closingProfiles.delete(profileId);
      }
    });
    this.closingProfiles.set(profileId, current);
    return current;
  }

  closeLaunchedProcess(profileId, record) {
    const child = record.child;
    return new Promise((resolve) => {
      let settled = false;
      let childExited = child.exitCode !== null;
      let childError = null;
      let terminationSucceeded = false;
      let timeout = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(result);
      };
      const finishWhenClosed = () => {
        if (childExited && terminationSucceeded) {
          this.clearTerminationUncertain(profileId, record);
          finish({ success: true });
        }
      };

      child.once('exit', () => {
        childExited = true;
        finishWhenClosed();
      });
      child.once('error', (error) => {
        if (settled) return;
        childError = error;
        if (terminationSucceeded) {
          this.markTerminationUncertain(profileId, record);
          finish({ success: false, error: error.message });
        }
      });

      Promise.resolve()
        .then(() => this.terminateLaunchedProcess(record))
        .then((signaled) => {
          if (signaled === false) {
            this.markTerminationUncertain(profileId, record);
            finish({ success: false, error: 'Failed to signal browser process' });
            return;
          }
          terminationSucceeded = true;
          if (childError) {
            this.markTerminationUncertain(profileId, record);
            finish({ success: false, error: childError.message });
            return;
          }
          finishWhenClosed();
          if (!childExited) {
            timeout = setTimeout(() => {
              this.markTerminationUncertain(profileId, record);
              finish({ success: false, error: 'Timed out waiting for browser to close' });
            }, this.closeTimeoutMs);
            timeout.unref?.();
          }
        })
        .catch((error) => {
          this.markTerminationUncertain(profileId, record);
          finish({ success: false, error: error.message });
        });
    });
  }

  markTerminationUncertain(profileId, record) {
    if (this.uncertainProfiles.get(profileId) === record) return;
    this.uncertainProfiles.set(profileId, record);
    this.notifyStateChange();
  }

  clearTerminationUncertain(profileId, record) {
    if (this.uncertainProfiles.get(profileId) !== record) return;
    this.uncertainProfiles.delete(profileId);
    this.notifyStateChange();
  }

  async performRecoveredProcessClose(profileId, record) {
    const initialVerification = await this.getFreshRecordVerification(record);
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
    if (this.processes.get(profileId) !== record) {
      return { success: false, error: 'Browser not running' };
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

  async getFreshRecordVerification(record) {
    const pendingVerification = record.verificationPromise;
    if (pendingVerification) {
      try {
        await pendingVerification;
      } catch {
        // A fresh dedicated verification still runs below.
      }
    }
    try {
      const result = normalizeVerificationResult(
        await this.verifyProcess(toPersistedRecord(record)),
      );
      if (result === PROCESS_VERIFIED) record.lastVerifiedAt = this.now();
      return result;
    } catch {
      return PROCESS_UNAVAILABLE;
    }
  }

  isRunning(profileId) {
    if (
      this.pendingProfiles.has(profileId)
      || this.closingProfiles.has(profileId)
      || this.uncertainProfiles.has(profileId)
    ) {
      return true;
    }
    const record = this.processes.get(profileId);
    return Boolean(record && (!record.child || record.child.exitCode === null));
  }

  async getStatus(profileId, { force = false } = {}) {
    if (this.uncertainProfiles.has(profileId)) {
      const record = this.uncertainProfiles.get(profileId);
      return {
        running: true,
        verificationUnavailable: true,
        ...(record.child ? { closeRetryAvailable: true } : {}),
      };
    }
    if (this.pendingProfiles.has(profileId) || this.closingProfiles.has(profileId)) {
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

  async getStatuses(profileIds, { force = false } = {}) {
    if (this.verifyProcesses) {
      const statuses = {};
      const recordsToVerify = [];
      for (const profileId of profileIds) {
        if (this.uncertainProfiles.has(profileId)) {
          const record = this.uncertainProfiles.get(profileId);
          statuses[profileId] = {
            running: true,
            verificationUnavailable: true,
            ...(record.child ? { closeRetryAvailable: true } : {}),
          };
          continue;
        }
        if (this.pendingProfiles.has(profileId) || this.closingProfiles.has(profileId)) {
          statuses[profileId] = { running: true };
          continue;
        }
        const record = this.processes.get(profileId);
        if (!record) {
          statuses[profileId] = { running: false };
        } else if (record.child) {
          statuses[profileId] = { running: record.child.exitCode === null };
        } else if (
          !force
          && record.lastVerifiedAt !== undefined
          && this.now() - record.lastVerifiedAt < this.verificationCacheMs
        ) {
          statuses[profileId] = { running: true };
        } else {
          recordsToVerify.push(record);
        }
      }

      if (recordsToVerify.length > 0) {
        const newRecords = recordsToVerify.filter((record) => !record.verificationPromise);
        if (newRecords.length > 0) {
          const batchPromise = Promise.resolve()
            .then(() => this.verifyProcesses(newRecords.map(toPersistedRecord)))
            .catch(() => ({}));
          for (const record of newRecords) {
            const verificationPromise = batchPromise.then((verifications) => (
              normalizeVerificationResult(verifications[record.profileId])
            ));
            const current = verificationPromise.finally(() => {
              if (record.verificationPromise === current) {
                record.verificationPromise = null;
              }
            });
            record.verificationPromise = current;
          }
        }
        let changed = false;
        const pendingVerifications = recordsToVerify.map((record) => ({
          record,
          promise: record.verificationPromise,
        }));
        for (const { record, promise } of pendingVerifications) {
          const verification = await promise;
          if (verification === PROCESS_VERIFIED) {
            record.lastVerifiedAt = this.now();
            statuses[record.profileId] = { running: true };
          } else if (verification === PROCESS_MISMATCH) {
            if (this.processes.get(record.profileId) === record) {
              this.processes.delete(record.profileId);
              changed = true;
            }
            statuses[record.profileId] = { running: false };
          } else {
            statuses[record.profileId] = {
              running: true,
              verificationUnavailable: true,
            };
          }
        }
        if (changed) this.notifyStateChange();
      }
      return statuses;
    }

    const entries = await Promise.all(profileIds.map(async (profileId) => [
      profileId,
      await this.getStatus(profileId, { force }),
    ]));
    return Object.fromEntries(entries);
  }

  async forget(profileId, { acknowledgePossibleRunning = false } = {}) {
    const uncertainRecord = this.uncertainProfiles.get(profileId);
    if (uncertainRecord) {
      if (acknowledgePossibleRunning !== true) {
        return {
          success: false,
          error: 'Confirmation required to clear a possibly running process record',
        };
      }
      this.uncertainProfiles.delete(profileId);
      if (this.processes.get(profileId) === uncertainRecord) {
        this.processes.delete(profileId);
      }
      this.notifyStateChange();
      return { success: true };
    }

    const record = this.processes.get(profileId);
    if (!record) return { success: false, error: 'Browser process not found' };
    if (record.child) {
      return {
        success: false,
        error: 'Close the browser before forgetting its process',
      };
    }
    const verification = await this.getRecordVerification(record, { force: true });
    if (
      verification !== PROCESS_MISMATCH
      && acknowledgePossibleRunning !== true
    ) {
      return {
        success: false,
        error: 'Confirmation required to clear a possibly running process record',
      };
    }
    this.processes.delete(profileId);
    this.notifyStateChange();
    return { success: true };
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
    const records = new Map(
      [...this.processes].map(([profileId, record]) => [
        profileId,
        toPersistedRecord(record),
      ]),
    );
    for (const [profileId, record] of this.uncertainProfiles) {
      records.set(profileId, {
        ...toPersistedRecord(record),
        terminationUncertain: true,
      });
    }
    return [...records.values()];
  }

  notifyStateChange() {
    this.onStateChange(this.getPersistedRecords());
  }
}

module.exports = {
  BrowserProcessManager,
  buildBrowserArgs,
};
