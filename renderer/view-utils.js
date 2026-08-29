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

  return { escapeHtml, summarizeResults, getRunningProfileIds };
}));
