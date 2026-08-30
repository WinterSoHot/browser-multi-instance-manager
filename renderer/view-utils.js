(function exposeViewUtils(root, factory) {
  const viewUtils = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = viewUtils;
  } else {
    root.viewUtils = viewUtils;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function summarizeResults(results) {
    const successfulResults = results.filter((result) => result.success);
    const failedResults = results.filter((result) => !result.success);

    return {
      successCount: successfulResults.length,
      failureCount: failedResults.length,
      errors: failedResults.map((result) => result.error).filter(Boolean),
    };
  }

  async function getRunningProfileIds(profiles, getStatus) {
    const runningProfileIds = await Promise.all(profiles.map(async (profile) => {
      try {
        const status = await getStatus(profile.id);
        return status.running ? profile.id : null;
      } catch {
        return null;
      }
    }));

    return runningProfileIds.filter(Boolean);
  }

  function createNonOverlappingTask(task) {
    let running = false;
    return async function runTask() {
      if (running) return false;
      running = true;
      try {
        await task();
        return true;
      } finally {
        running = false;
      }
    };
  }

  function filterProfiles(profiles, browserType = 'all', query = '') {
    const normalizedQuery = String(query).trim().toLocaleLowerCase();
    return profiles.filter((profile) => (
      (browserType === 'all' || profile.browserType === browserType)
      && (
        normalizedQuery === ''
        || profile.name.toLocaleLowerCase().includes(normalizedQuery)
      )
    ));
  }

  async function mapWithConcurrency(items, limit, worker, onProgress = () => {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Concurrency limit must be a positive integer');
    }
    const results = new Array(items.length);
    let nextIndex = 0;
    let completed = 0;

    async function runWorker() {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
        completed += 1;
        onProgress(completed, items.length);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
    );
    return results;
  }

  function normalizeStatusSnapshot(snapshot) {
    const runningIds = [];
    const unknownIds = [];
    for (const [profileId, status] of Object.entries(snapshot || {})) {
      if (status?.verificationUnavailable) {
        unknownIds.push(profileId);
      } else if (status?.running) {
        runningIds.push(profileId);
      }
    }
    return { runningIds, unknownIds };
  }

  function formatBatchErrors(errors, limit = 3) {
    const visibleErrors = errors.slice(0, limit);
    const remaining = errors.length - visibleErrors.length;
    if (remaining > 0) visibleErrors.push(`另有 ${remaining} 个错误`);
    return visibleErrors.join('；');
  }

  return {
    escapeHtml,
    summarizeResults,
    getRunningProfileIds,
    createNonOverlappingTask,
    filterProfiles,
    mapWithConcurrency,
    normalizeStatusSnapshot,
    formatBatchErrors,
  };
}));
