const updateVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const updateReleasePattern = /^https:\/\/github\.com\/WinterSoHot\/browser-multi-instance-manager\/releases\/tag\/v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$/u;
const updateErrorCodes = new Set([
  'UPDATE_CHECK_TIMEOUT', 'UPDATE_CHECK_NETWORK_ERROR', 'UPDATE_CHECK_HTTP_ERROR',
  'UPDATE_CHECK_RATE_LIMITED', 'UPDATE_CHECK_REDIRECT', 'UPDATE_CHECK_RESPONSE_TOO_LARGE',
  'UPDATE_CHECK_RESPONSE_INVALID', 'UPDATE_CHECK_ABORTED', 'UPDATE_CHECK_FAILED',
  'UPDATE_CHECK_REQUEST_FAILED',
]);

function isStableVersion(version) {
  return typeof version === 'string'
    && updateVersionPattern.test(version)
    && version.split('.').every((part) => Number.isSafeInteger(Number(part)));
}

function isNewerVersion(version, currentVersion) {
  if (!isStableVersion(currentVersion)) return true;
  const remote = version.split('.').map(Number);
  const current = currentVersion.split('.').map(Number);
  for (let index = 0; index < remote.length; index += 1) {
    if (remote[index] !== current[index]) return remote[index] > current[index];
  }
  return false;
}

function sanitizeUpdateResult(result, currentVersion) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED' };
  }
  if (result.status === 'current' && Object.keys(result).length === 1) return { status: 'current' };
  if (result.status === 'available' && Object.keys(result).length === 3
    && typeof result.version === 'string' && typeof result.releaseUrl === 'string'
    && isStableVersion(result.version) && isNewerVersion(result.version, currentVersion)
    && updateReleasePattern.exec(result.releaseUrl)?.[1] === result.version) {
    return { status: 'available', version: result.version, releaseUrl: result.releaseUrl };
  }
  if (result.status === 'cached' && Object.keys(result).length === 2) {
    const nested = sanitizeUpdateResult(result.result, currentVersion);
    if (nested.status === 'current' || nested.status === 'available') {
      return { status: 'cached', result: nested };
    }
  }
  if (result.status === 'error' && Object.keys(result).length === 2 && updateErrorCodes.has(result.code)) {
    return { status: 'error', code: result.code };
  }
  return { status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED' };
}

function createUpdateUiController({ checkForUpdates, openReleasePage, render, currentVersion }) {
  let busy = false;
  let available = null;
  let dismissedVersion = null;

  function view(result = null) {
    render({ busy, result, available: available && { ...available }, showNotice: shouldShowNotice() });
  }

  function shouldShowNotice() {
    return Boolean(available && dismissedVersion !== available.version);
  }

  async function check(force) {
    if (busy) return null;
    busy = true;
    view();
    let result;
    try {
      result = sanitizeUpdateResult(await checkForUpdates(force), currentVersion);
    } catch {
      result = { status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED' };
    }
    applyResult(result, false);
    busy = false;
    view(result);
    return result;
  }

  function applyResult(rawResult, shouldRender = true) {
    const result = sanitizeUpdateResult(rawResult, currentVersion);
    const update = result.status === 'cached' ? result.result : result;
    if (update.status === 'available') {
      available = { version: update.version, releaseUrl: update.releaseUrl };
    } else if (update.status === 'current') {
      available = null;
    }
    if (shouldRender) view(result);
    return result;
  }

  async function openAvailable() {
    if (!available) return { success: false, code: 'OPEN_RELEASE_PAGE_FAILED' };
    try {
      const result = await openReleasePage(available.releaseUrl);
      return result?.success === true ? { success: true } : { success: false, code: 'OPEN_RELEASE_PAGE_FAILED' };
    } catch {
      return { success: false, code: 'OPEN_RELEASE_PAGE_FAILED' };
    }
  }

  function dismiss() {
    if (available) dismissedVersion = available.version;
    view();
  }

  return {
    check,
    accept: (result) => applyResult(result),
    dismiss,
    openAvailable,
    getAvailable: () => available && { ...available },
    isBusy: () => busy,
    shouldShowNotice,
  };
}

if (typeof module !== 'undefined') module.exports = { createUpdateUiController, sanitizeUpdateResult };
if (typeof window !== 'undefined') window.createUpdateUiController = createUpdateUiController;
