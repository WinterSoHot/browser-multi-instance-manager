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
        return await worker(profileId);
      } catch (error) {
        return { success: false, error: error?.message || '请求失败' };
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

  return { executeWorkspaceBatch, createWorkspaceBatchRunner };
}));
