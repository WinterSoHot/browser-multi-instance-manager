(function diagnosticsViewModule(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.diagnosticsView = api;
}(typeof window === 'undefined' ? null : window, () => {
  const allowedActionsByState = {
    'process-unknown': new Set(['retry']),
    'browser-path-invalid': new Set(['retry', 'open-settings']),
    'profile-directory-missing': new Set(['retry', 'recreate-empty-directory']),
    healthy: new Set(),
  };
  const badgeLabels = {
    'process-unknown': '进程状态未知',
    'browser-path-invalid': '浏览器路径无效',
    'profile-directory-missing': '配置目录缺失',
  };

  function sanitizeDiagnostic(diagnostic) {
    const state = Object.prototype.hasOwnProperty.call(allowedActionsByState, diagnostic?.state)
      ? diagnostic.state
      : 'process-unknown';
    const allowedActions = allowedActionsByState[state];
    const actions = Array.isArray(diagnostic?.actions)
      ? diagnostic.actions.filter((action, index, all) => (
        allowedActions.has(action) && all.indexOf(action) === index
      ))
      : [];
    return {
      code: typeof diagnostic?.code === 'string' && /^[A-Z_]+$/u.test(diagnostic.code)
        ? diagnostic.code
        : 'UNKNOWN',
      state,
      actions,
    };
  }

  function getDiagnosticBadge(diagnostic) {
    const state = sanitizeDiagnostic(diagnostic).state;
    const label = badgeLabels[state];
    return label ? { label, className: `diagnostic-badge ${state}` } : null;
  }

  function createModalFocusManager(getFocusableElements) {
    function getInitialFocusTarget(container) {
      return getFocusableElements(container)[0] || null;
    }

    function getNextFocusTarget({ container, activeElement, shiftKey }) {
      const focusableElements = getFocusableElements(container);
      if (focusableElements.length === 0) return null;
      const currentIndex = focusableElements.indexOf(activeElement);
      if (currentIndex === -1) {
        return shiftKey ? focusableElements.at(-1) : focusableElements[0];
      }
      if (shiftKey && currentIndex === 0) return focusableElements.at(-1);
      if (!shiftKey && currentIndex === focusableElements.length - 1) {
        return focusableElements[0];
      }
      return null;
    }

    return { getInitialFocusTarget, getNextFocusTarget };
  }

  async function refreshDiagnosticsModalAfterAction({
    profileId,
    requestDiagnostics,
    getOpenProfileId,
    isModalOpen,
    renderProfiles,
    renderDiagnosticsModal,
    focusDiagnosticsModal,
  }) {
    await requestDiagnostics(profileId);
    if (getOpenProfileId() !== profileId || !isModalOpen()) return false;
    renderProfiles();
    renderDiagnosticsModal(profileId);
    if (getOpenProfileId() !== profileId || !isModalOpen()) return false;
    focusDiagnosticsModal();
    return true;
  }

  function createDiagnosticsViewState() {
    let requestNumber = 0;
    const latestRequests = new Map();
    const diagnostics = new Map();

    function begin(profileId) {
      const token = { profileId, requestNumber: ++requestNumber };
      latestRequests.set(profileId, token.requestNumber);
      return token;
    }

    function accept(token, diagnostic, currentProfileIds) {
      if (
        !token
        || latestRequests.get(token.profileId) !== token.requestNumber
        || !currentProfileIds.has(token.profileId)
      ) {
        return false;
      }
      diagnostics.set(token.profileId, sanitizeDiagnostic(diagnostic));
      return true;
    }

    function remove(profileId) {
      latestRequests.set(profileId, ++requestNumber);
      diagnostics.delete(profileId);
    }

    return {
      begin,
      accept,
      remove,
      get(profileId) {
        return diagnostics.get(profileId) || null;
      },
    };
  }

  return {
    createDiagnosticsViewState,
    createModalFocusManager,
    refreshDiagnosticsModalAfterAction,
    getDiagnosticBadge,
    sanitizeDiagnostic,
  };
}));
