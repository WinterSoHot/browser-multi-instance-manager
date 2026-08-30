(function exposeWorkspaceBatch(root, factory) {
  const workspaceBatch = factory(
    typeof module === 'object' && module.exports
      ? require('./view-utils')
      : root.viewUtils,
  );

  if (typeof module === 'object' && module.exports) {
    module.exports = workspaceBatch;
  } else {
    root.workspaceBatch = workspaceBatch;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, ({
  createStatusMembership,
  filterCloseableProfileIds,
  formatBatchErrors,
  mapWithConcurrency,
  normalizeStatusSnapshot,
  summarizeResults,
}) => {
  const batchFailureMessages = {
    BROWSER_PATH_INVALID: '浏览器路径不可用',
    BROWSER_ALREADY_RUNNING: '浏览器已在运行',
    PROFILE_LAUNCH_FAILED: '启动失败',
    PROCESS_STATE_UNKNOWN: '进程状态未知',
    PROFILE_NOT_FOUND: '配置不存在',
    PROFILE_REQUEST_FAILED: '请求失败',
    PROCESS_REQUEST_FAILED: '请求失败',
    BATCH_OPERATION_FAILED: '请求失败',
  };

  function sanitizeBatchResult(result) {
    if (result?.success === true) {
      return {
        success: true,
        ...(result.warningCode === 'LAST_LAUNCHED_AT_NOT_RECORDED'
          ? { warningCode: result.warningCode }
          : {}),
      };
    }
    const code = Object.prototype.hasOwnProperty.call(batchFailureMessages, result?.code)
      ? result.code
      : 'BATCH_OPERATION_FAILED';
    return { success: false, code, error: batchFailureMessages[code] };
  }

  async function executeWorkspaceBatch({
    action,
    profiles,
    getBrowserStatuses,
    launchBrowser,
    closeBrowser,
    onProgress = () => {},
  }) {
    const profileIds = profiles.map((profile) => profile.id);
    let snapshot;
    try {
      snapshot = await getBrowserStatuses(profileIds, { force: true });
    } catch {
      snapshot = Object.fromEntries(profileIds.map((profileId) => [
        profileId,
        { verificationUnavailable: true },
      ]));
    }
    const status = createStatusMembership(normalizeStatusSnapshot(snapshot));
    const targetIds = action === 'launch'
      ? profileIds.filter((profileId) => (
        !status.runningIds.has(profileId) && !status.unknownIds.has(profileId)
      ))
      : filterCloseableProfileIds(profileIds, status.runningIds, status.retryableCloseIds);
    const worker = action === 'launch' ? launchBrowser : closeBrowser;
    const results = await mapWithConcurrency(targetIds, 4, async (profileId) => {
      try {
        return sanitizeBatchResult(await worker(profileId));
      } catch {
        return sanitizeBatchResult(null);
      }
    }, onProgress);
    const summary = summarizeResults(results);
    return {
      snapshot,
      targetIds,
      results,
      summary: {
        ...summary,
        details: formatBatchErrors(summary.errors, 1),
      },
    };
  }

  function createWorkspaceBatchRunner(operation) {
    let running = false;
    return async function runWorkspaceBatch(...args) {
      if (running) return { skipped: true };
      running = true;
      try {
        return await operation(...args);
      } finally {
        running = false;
      }
    };
  }

  function createPageBatchCoordinator(onBusyChange = () => {}) {
    let running = false;
    return {
      async run(operation) {
        if (running) return { skipped: true, code: 'BATCH_ALREADY_RUNNING' };
        running = true;
        try {
          onBusyChange(true);
          return await operation();
        } finally {
          running = false;
          onBusyChange(false);
        }
      },
      isRunning() {
        return running;
      },
    };
  }

  return {
    executeWorkspaceBatch,
    createWorkspaceBatchRunner,
    createPageBatchCoordinator,
    sanitizeBatchResult,
  };
}));
