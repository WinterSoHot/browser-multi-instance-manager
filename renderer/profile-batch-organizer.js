(function exposeProfileBatchOrganizer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.profileBatchOrganizer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function createBatchMenuState() {
    let count = 0;
    let open = false;
    let busy = false;
    return {
      setSelectedCount(value) {
        count = Number.isSafeInteger(value) && value > 0 ? value : 0;
        if (count === 0) open = false;
      },
      setBusy(value) {
        busy = value === true;
        if (busy) open = false;
      },
      toggle() {
        if (count > 0 && !busy) open = !open;
      },
      close() { open = false; },
      getSnapshot() { return { count, visible: count > 0, open, busy }; },
    };
  }

  function nextMenuItemIndex(currentIndex, key, itemCount) {
    if (!Number.isSafeInteger(itemCount) || itemCount < 1) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return itemCount - 1;
    if (key === 'ArrowDown') return (currentIndex + 1 + itemCount) % itemCount;
    if (key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
    return null;
  }

  function normalizeMutationResult(result, requestedIds) {
    if (result?.success !== true) {
      return { success: false, code: result?.code || 'BATCH_ORGANIZATION_FAILED' };
    }
    const requested = new Set(requestedIds);
    const used = new Set();
    const buckets = {};
    for (const key of ['updatedIds', 'unchangedIds', 'skippedIds']) {
      if (!Array.isArray(result[key])) {
        return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
      }
      buckets[key] = [];
      for (const profileId of result[key]) {
        if (typeof profileId !== 'string'
          || !requested.has(profileId)
          || used.has(profileId)) {
          return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
        }
        used.add(profileId);
        buckets[key].push(profileId);
      }
    }
    if (used.size !== requested.size) {
      return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
    }
    return { success: true, ...buckets };
  }

  function formatMutationSummary(result) {
    return `已更新 ${result.updatedIds.length} 项、未变化 ${result.unchangedIds.length} 项、跳过 ${result.skippedIds.length} 项`;
  }

  function createProfileBatchOrganizer({
    runBatch,
    assignProfilesWorkspace,
    setProfilesFavorite,
    exportSelectedProfiles,
    reloadProfiles,
  }) {
    async function runMutation(profileIds, operation) {
      return runBatch(async () => {
        let rawResult;
        try {
          rawResult = await operation();
        } catch {
          return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
        }
        const result = normalizeMutationResult(rawResult, profileIds);
        if (!result.success) return result;
        let refreshFailed = false;
        try {
          await reloadProfiles();
        } catch {
          refreshFailed = true;
        }
        return {
          success: true,
          message: formatMutationSummary(result),
          refreshFailed,
        };
      });
    }

    return {
      assignWorkspace(profileIds, workspaceId) {
        return runMutation(
          profileIds,
          () => assignProfilesWorkspace(profileIds, workspaceId),
        );
      },
      setFavorite(profileIds, favorite) {
        return runMutation(
          profileIds,
          () => setProfilesFavorite(profileIds, favorite),
        );
      },
      exportSelected(profileIds) {
        return runBatch(async () => {
          let result;
          try {
            result = await exportSelectedProfiles(profileIds);
          } catch {
            return { success: false, code: 'BATCH_ORGANIZATION_FAILED' };
          }
          if (result?.canceled === true) {
            return { success: false, canceled: true, message: '已取消导出' };
          }
          if (result?.success !== true
            || !Number.isSafeInteger(result.count)
            || result.count < 1
            || !Number.isSafeInteger(result.skippedCount)
            || result.skippedCount < 0) {
            return { success: false, code: result?.code || 'BATCH_ORGANIZATION_FAILED' };
          }
          return {
            success: true,
            message: result.skippedCount > 0
              ? `已导出 ${result.count} 项、跳过 ${result.skippedCount} 项`
              : `已导出 ${result.count} 项`,
          };
        });
      },
    };
  }

  return { createBatchMenuState, nextMenuItemIndex, normalizeMutationResult,
    formatMutationSummary, createProfileBatchOrganizer };
}));
