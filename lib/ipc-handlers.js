const { types: { isProxy } } = require('node:util');

const {
  validateBatchProfileIds,
  validateProfileId,
  validateProfileIds,
} = require('./ipc-validation');
const { DEFAULT_APP_SETTINGS, validateAppSettings } = require('./app-store');
const {
  parseSemver,
  sanitizeUpdateResult: sanitizeUpdateCheckResult,
  validateReleaseUrl,
} = require('./update-checker');

const BATCH_PROFILE_PARSE_FAILED = Symbol('batch profile parse failed');

function registerIpcHandlers({
  ipcMain,
  profileService,
  browserProcessManager,
  settingsService,
  appSettingsService,
  workspaceService,
  diagnosticsService,
  updateChecker,
  appVersion,
  openExternal,
}) {
  const safeProfileErrors = new Set([
    'Unsupported browser type',
    'Invalid profile name',
    'Profile name already exists',
    'Profile not found',
    'Close the browser before removing its profile',
    'Close the browser before renaming its profile',
    'Profile path is invalid',
    'Profile folder not found',
  ]);
  const safeProfileMessages = new Map([
    ['PROFILE_ADD_FAILED', 'Unable to add profile'],
    ['PROFILE_REMOVE_FAILED', 'Unable to remove profile'],
    ['PROFILE_RENAME_FAILED', 'Unable to rename profile'],
    ['PROFILE_CLONE_FAILED', 'Unable to clone profile'],
    ['PROFILE_SIZE_FAILED', 'Unable to read profile size'],
    ['PROFILE_OPEN_FAILED', 'Unable to open profile folder'],
    ['PROFILE_LAUNCH_FAILED', 'Unable to launch browser'],
    ['PROFILE_EXPORT_FAILED', 'Unable to export profiles'],
    ['BROWSER_PATH_INVALID', 'Browser path is invalid'],
    ['BROWSER_ALREADY_RUNNING', 'Browser already running'],
  ]);
  const safeProcessErrors = new Set([
    'Browser already running',
    'Browser is still starting',
    'Browser not running',
    'Unable to verify browser process',
    'Failed to signal browser process',
    'Timed out waiting for browser to close',
    'Confirmation required to clear a possibly running process record',
    'Browser process not found',
    'Close the browser before forgetting its process',
  ]);
  const safeSettingsErrors = new Set([
    'Invalid browser settings',
    'Unsupported browser type',
    'Invalid browser executable path',
    'chrome executable does not exist',
    'firefox executable does not exist',
    'edge executable does not exist',
    'zen executable does not exist',
  ]);
  const safeWorkspaceErrors = new Set([
    'Invalid workspace request',
    'Invalid workspace ID',
    'Invalid profile ID',
    'Invalid favorite value',
    'Invalid workspace name',
    'Workspace name already exists',
    'Workspace not found',
    'Profile not found',
    'Workspace request failed',
  ]);

  function failure(code, error) {
    return { success: false, code, error };
  }

  function readExactRecord(value, keys) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
      const actualKeys = Reflect.ownKeys(value);
      if (!actualKeys.every((key) => typeof key === 'string')) return null;
      actualKeys.sort();
      if (actualKeys.length !== keys.length
        || !actualKeys.every((key, index) => key === keys[index])) return null;
      const record = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
        record[key] = descriptor.value;
      }
      return record;
    } catch {
      return null;
    }
  }

  function sanitizeUpdateResult(result) {
    return sanitizeUpdateCheckResult(result, appVersion);
  }

  function validateUpdateCheckRequest(payload) {
    const request = readExactRecord(payload, ['force']);
    if (!request || typeof request.force !== 'boolean') {
      throw new Error('Invalid update check request');
    }
    return { force: request.force };
  }

  function sanitizeStatus(status) {
    if (!status || typeof status !== 'object' || typeof status.running !== 'boolean') {
      return { running: false, verificationUnavailable: true };
    }
    return {
      running: status.running,
      ...(status.verificationUnavailable === true ? { verificationUnavailable: true } : {}),
      ...(status.closeRetryAvailable === true ? { closeRetryAvailable: true } : {}),
    };
  }

  function readAppSettingsOrDefault(settings) {
    try {
      return validateAppSettings(settings);
    } catch {
      return { ...DEFAULT_APP_SETTINGS };
    }
  }

  function isCompleteAppSettings(settings) {
    try {
      validateAppSettings(settings);
      return true;
    } catch {
      return false;
    }
  }

  function unknownStatuses(profileIds) {
    if (!Array.isArray(profileIds)) return {};
    return Object.fromEntries(profileIds
      .filter((profileId) => typeof profileId === 'string' && profileId.trim() !== '')
      .slice(0, 1000)
      .map((profileId) => [profileId, sanitizeStatus(null)]));
  }

  function sanitizeBatchMutationResult(result, payload) {
    if (result === BATCH_PROFILE_PARSE_FAILED) {
      return { success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' };
    }
    if (result?.success !== true) {
      if (result?.error === 'Workspace not found') {
        return { success: false, code: 'WORKSPACE_NOT_FOUND' };
      }
      return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
    }
    let requestedIds;
    try {
      requestedIds = validateBatchProfileIds(payload?.profileIds);
    } catch {
      return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
    }
    const requested = new Set(requestedIds);
    const used = new Set();
    const sanitized = {};
    for (const key of ['updatedIds', 'unchangedIds', 'skippedIds']) {
      if (!Array.isArray(result[key])) {
        return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
      }
      sanitized[key] = [];
      for (const profileId of result[key]) {
        if (typeof profileId !== 'string'
          || !requested.has(profileId)
          || used.has(profileId)) {
          return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
        }
        used.add(profileId);
        sanitized[key].push(profileId);
      }
    }
    if (used.size !== requested.size) {
      return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
    }
    return { success: true, ...sanitized };
  }

  function sanitizeSelectedExportResult(result) {
    if (result === BATCH_PROFILE_PARSE_FAILED) {
      return { success: false, code: 'BATCH_PROFILE_REQUEST_INVALID' };
    }
    if (result?.success === true
      && Number.isSafeInteger(result.count)
      && result.count > 0
      && Number.isSafeInteger(result.skippedCount)
      && result.skippedCount >= 0) {
      return { success: true, count: result.count, skippedCount: result.skippedCount };
    }
    if (result?.canceled === true) return { success: false, canceled: true };
    if (result?.code === 'PROFILE_EXPORT_EMPTY_SELECTION') {
      return { success: false, code: 'PROFILE_EXPORT_EMPTY_SELECTION' };
    }
    return { success: false, code: 'PROFILE_EXPORT_FAILED' };
  }

  function sanitizeResult(channel, result, args) {
    if (channel === 'get-profiles') return Array.isArray(result) ? result : [];
    if (channel === 'get-workspaces') return Array.isArray(result) ? result : [];
    if (channel === 'get-app-settings') return readAppSettingsOrDefault(result);
    if (channel === 'set-app-settings') {
      if (result?.success === true && isCompleteAppSettings(result.settings)) {
        return { success: true, settings: validateAppSettings(result.settings) };
      }
      return failure('APP_SETTINGS_REQUEST_FAILED', 'Unable to save app settings');
    }
    if (channel === 'get-app-version') {
      return typeof result === 'string' && parseSemver(result) ? result : '0.0.0';
    }
    if (channel === 'check-for-updates') return sanitizeUpdateResult(result);
    if (channel === 'open-release-page') {
      return result?.success === true
        ? { success: true }
        : { success: false, code: result?.code === 'INVALID_RELEASE_URL'
          ? 'INVALID_RELEASE_URL' : 'OPEN_RELEASE_PAGE_FAILED' };
    }
    if (channel === 'get-browser-status' || channel === 'refresh-browser-status') {
      return sanitizeStatus(result);
    }
    if (channel === 'get-browser-statuses') {
      const profileIds = Array.isArray(args[1]) ? args[1] : [];
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return unknownStatuses(profileIds);
      }
      return Object.fromEntries(profileIds.map((profileId) => [
        profileId,
        sanitizeStatus(result[profileId]),
      ]));
    }
    if (['assign-profiles-workspace', 'set-profiles-favorite'].includes(channel)) {
      return sanitizeBatchMutationResult(result, args[1]);
    }
    if (channel === 'export-selected-profiles') return sanitizeSelectedExportResult(result);
    if (channel === 'launch-browser' && result?.success === true) {
      return {
        success: true,
        ...(result.warningCode === 'LAST_LAUNCHED_AT_NOT_RECORDED'
          ? { warningCode: result.warningCode }
          : {}),
      };
    }
    if (['close-browser', 'forget-browser-process'].includes(channel)
      && result?.success === true) {
      return { success: true };
    }

    if (channel === 'export-profiles' && result?.success === false && result.canceled === true) {
      return { success: false, canceled: true };
    }
    if (['add-profile', 'delete-profile', 'launch-browser', 'rename-profile',
      'open-profile-folder', 'clone-profile', 'get-profile-size', 'export-profiles']
      .includes(channel) && result?.success === false) {
      if (safeProfileMessages.has(result.code)) {
        return failure(result.code, safeProfileMessages.get(result.code));
      }
      if (safeProfileErrors.has(result.error)) {
        return {
          success: false,
          error: result.error,
          ...(result.canceled === true ? { canceled: true } : {}),
        };
      }
      return failure('PROFILE_REQUEST_FAILED', 'Profile request failed');
    }
    if (['close-browser', 'forget-browser-process'].includes(channel)
      && result?.success === false) {
      if (safeProcessErrors.has(result.error)) {
        const processCode = {
          'Browser already running': 'BROWSER_ALREADY_RUNNING',
          'Browser is still starting': 'BROWSER_STILL_STARTING',
          'Browser not running': 'BROWSER_NOT_RUNNING',
          'Unable to verify browser process': 'PROCESS_STATE_UNKNOWN',
          'Failed to signal browser process': 'PROCESS_SIGNAL_FAILED',
          'Timed out waiting for browser to close': 'PROCESS_CLOSE_TIMEOUT',
          'Confirmation required to clear a possibly running process record': 'PROCESS_CONFIRMATION_REQUIRED',
          'Browser process not found': 'PROCESS_RECORD_NOT_FOUND',
          'Close the browser before forgetting its process': 'PROFILE_RUNNING',
        }[result.error];
        return failure(processCode, result.error);
      }
      return failure('PROCESS_REQUEST_FAILED', 'Process request failed');
    }
    if (['set-browser-settings', 'browse-folder'].includes(channel)
      && result?.success === false) {
      if (result.path === null && result.error === undefined) return result;
      if (safeSettingsErrors.has(result.error)) {
        return { success: false, error: result.error };
      }
      return failure('SETTINGS_REQUEST_FAILED', 'Settings request failed');
    }
    if (['create-workspace', 'rename-workspace', 'delete-workspace',
      'assign-profile-workspace', 'set-profile-favorite'].includes(channel)
      && result?.success === false) {
      if (safeWorkspaceErrors.has(result.error)) {
        return { success: false, error: result.error };
      }
      return failure('WORKSPACE_REQUEST_FAILED', 'Workspace request failed');
    }
    return result;
  }

  function fallbackResult(channel, args) {
    if (channel === 'get-profiles' || channel === 'get-workspaces') return [];
    if (channel === 'get-browser-status' || channel === 'refresh-browser-status') {
      return sanitizeStatus(null);
    }
    if (channel === 'get-browser-statuses') return unknownStatuses(args[1]);
    if (channel === 'inspect-profile-diagnostics') {
      return { code: 'DIAGNOSTICS_UNAVAILABLE', state: 'process-unknown', actions: ['retry'] };
    }
    if (channel === 'repair-profile-directory') {
      return { success: false, code: 'DIAGNOSTICS_UNAVAILABLE' };
    }
    if (channel === 'preview-import') return { success: false, code: 'IMPORT_PREVIEW_FAILED' };
    if (channel === 'execute-import') return { success: false, code: 'IMPORT_REQUEST_INVALID' };
    if (['assign-profiles-workspace', 'set-profiles-favorite'].includes(channel)) {
      return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
    }
    if (channel === 'export-selected-profiles') {
      return { success: false, code: 'PROFILE_EXPORT_FAILED' };
    }
    if (channel === 'get-browser-settings') return {};
    if (channel === 'get-app-settings') return { ...DEFAULT_APP_SETTINGS };
    if (channel === 'get-default-browser-path') return '';
    if (channel === 'get-platform') return 'unknown';
    if (channel === 'get-browser-environment') {
      return { platform: 'unknown', settings: {}, defaultPaths: {}, validity: {} };
    }
    if (['set-browser-settings', 'browse-folder'].includes(channel)) {
      return failure('SETTINGS_REQUEST_FAILED', 'Settings request failed');
    }
    if (channel === 'set-app-settings') {
      return failure('APP_SETTINGS_REQUEST_FAILED', 'Unable to save app settings');
    }
    if (channel === 'get-app-version') return '0.0.0';
    if (channel === 'check-for-updates') return { status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED' };
    if (channel === 'open-release-page') return { success: false, code: 'OPEN_RELEASE_PAGE_FAILED' };
    if (['close-browser', 'forget-browser-process'].includes(channel)) {
      return failure('PROCESS_REQUEST_FAILED', 'Process request failed');
    }
    if (channel.includes('workspace') || channel === 'set-profile-favorite') {
      return failure('WORKSPACE_REQUEST_FAILED', 'Workspace request failed');
    }
    return failure('PROFILE_REQUEST_FAILED', 'Profile request failed');
  }

  function validateWorkspaceId(workspaceId) {
    if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
      throw new Error('Invalid workspace ID');
    }
    return workspaceId;
  }

  function validateWorkspaceIdOrNull(workspaceId) {
    return workspaceId === null ? null : validateWorkspaceId(workspaceId);
  }

  function batchProfileRequest(payload, keys) {
    const request = readExactRecord(payload, keys);
    if (!request) throw new Error('Invalid batch profile request');
    return { ...request, profileIds: validateBatchProfileIds(request.profileIds) };
  }

  function batchWorkspaceRequest(payload) {
    const request = batchProfileRequest(payload, ['profileIds', 'workspaceId']);
    return {
      profileIds: request.profileIds,
      workspaceId: validateWorkspaceIdOrNull(request.workspaceId),
    };
  }

  function batchFavoriteRequest(payload) {
    const request = batchProfileRequest(payload, ['favorite', 'profileIds']);
    if (typeof request.favorite !== 'boolean') throw new Error('Invalid favorite value');
    return request;
  }

  function batchExportRequest(payload) {
    return batchProfileRequest(payload, ['profileIds']);
  }

  async function runBatchProfileRequest(parseRequest, payload, operation) {
    let request;
    try {
      request = parseRequest(payload);
    } catch {
      return BATCH_PROFILE_PARSE_FAILED;
    }
    try {
      return await operation(request);
    } catch {
      return { success: false, code: 'BATCH_PROFILE_UPDATE_FAILED' };
    }
  }

  function workspacePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid workspace request');
    }
    return payload;
  }

  async function workspaceRequest(operation) {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Error
        && [
          'Invalid workspace request',
          'Invalid workspace ID',
          'Invalid profile ID',
          'Invalid favorite value',
        ].includes(error.message)
      ) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Workspace request failed' };
    }
  }

  function validateStatusOptions(options) {
    if (options === undefined) return { force: false };
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Invalid browser status options');
    }
    if (Object.keys(options).some((key) => key !== 'force') || typeof options.force !== 'boolean') {
      throw new Error('Invalid browser status options');
    }
    return { force: options.force };
  }

  function validateImportRequest(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid import request');
    }
    if (Object.keys(payload).some((key) => key !== 'token' && key !== 'decisions')) {
      throw new Error('Invalid import request');
    }
    if (typeof payload.token !== 'string' || !/^[a-f0-9]{64}$/u.test(payload.token)) {
      throw new Error('Invalid import request');
    }
    if (!Array.isArray(payload.decisions) || payload.decisions.length > 1000) {
      throw new Error('Invalid import request');
    }
    for (const decision of payload.decisions) {
      if (
        !decision
        || typeof decision !== 'object'
        || Array.isArray(decision)
        || Object.keys(decision).some((key) => key !== 'line' && key !== 'action')
        || !Number.isInteger(decision.line)
        || decision.line < 1
        || (decision.action !== 'skip' && decision.action !== 'rename')
      ) {
        throw new Error('Invalid import request');
      }
    }
    return { token: payload.token, decisions: payload.decisions.map(({ line, action }) => ({ line, action })) };
  }

  async function executeImportRequest(payload) {
    try {
      return await profileService.executeImport(validateImportRequest(payload));
    } catch {
      return { success: false, code: 'IMPORT_REQUEST_INVALID' };
    }
  }

  async function previewImportRequest() {
    try {
      return await profileService.previewImportMetadata();
    } catch {
      return { success: false, code: 'IMPORT_PREVIEW_FAILED' };
    }
  }

  async function diagnosticsRequest(operation) {
    try {
      return await operation();
    } catch {
      return {
        code: 'DIAGNOSTICS_UNAVAILABLE',
        state: 'process-unknown',
        actions: ['retry'],
      };
    }
  }

  async function diagnosticsRepairRequest(operation) {
    try {
      return await operation();
    } catch {
      return { success: false, code: 'DIAGNOSTICS_UNAVAILABLE' };
    }
  }

  const channels = new Map([
    ['get-profiles', () => profileService.list()],
    ['add-profile', (_event, payload) => profileService.add(payload)],
    ['delete-profile', (_event, payload) => profileService.remove(payload)],
    ['launch-browser', (_event, profileId) => profileService.launch(profileId)],
    ['close-browser', (_event, profileId) => browserProcessManager.close(profileId)],
    ['get-browser-status', (_event, profileId) => browserProcessManager.getStatus(profileId)],
    ['get-browser-statuses', (_event, profileIds = [], options) => (
      browserProcessManager.getStatuses(
        validateProfileIds(profileIds),
        validateStatusOptions(options),
      )
    )],
    ['refresh-browser-status', (_event, profileId) => (
      browserProcessManager.getStatus(profileId, { force: true })
    )],
    ['forget-browser-process', (_event, payload = {}) => {
      const { profileId, acknowledgePossibleRunning = false } = payload;
      if (typeof acknowledgePossibleRunning !== 'boolean') {
        return { success: false, error: 'Invalid process record request' };
      }
      try {
        return browserProcessManager.forget(
          validateProfileId(profileId),
          { acknowledgePossibleRunning },
        );
      } catch {
        return { success: false, error: 'Process request failed' };
      }
    }],
    ['rename-profile', (_event, payload) => profileService.rename(payload)],
    ['open-profile-folder', (_event, profileId) => profileService.openFolder(profileId)],
    ['clone-profile', (_event, profileId) => profileService.cloneBlank(profileId)],
    ['get-profile-size', (_event, profileId) => profileService.size(profileId)],
    ['export-profiles', () => profileService.exportMetadata()],
    ['export-selected-profiles', (_event, payload) => runBatchProfileRequest(
      batchExportRequest,
      payload,
      (request) => profileService.exportMetadata(request.profileIds),
    )],
    ['preview-import', () => previewImportRequest()],
    ['execute-import', (_event, payload) => executeImportRequest(payload)],
    ['get-browser-settings', () => settingsService.get()],
    ['set-browser-settings', (_event, settings) => settingsService.set(settings)],
    ['get-default-browser-path', (_event, browserType) => (
      settingsService.getDefaultPath(browserType)
    )],
    ['get-platform', () => settingsService.getPlatform()],
    ['get-browser-environment', () => settingsService.getEnvironment()],
    ['browse-folder', (_event, defaultPath) => settingsService.browseFolder(defaultPath)],
    ['get-app-settings', () => appSettingsService.get()],
    ['set-app-settings', (_event, patch) => appSettingsService.set(patch)],
    ['get-app-version', () => appVersion],
    ['check-for-updates', (_event, payload) => updateChecker.check(validateUpdateCheckRequest(payload))],
    ['open-release-page', async (_event, releaseUrl) => {
      try {
        validateReleaseUrl(releaseUrl);
      } catch {
        return { success: false, code: 'INVALID_RELEASE_URL' };
      }
      try {
        await openExternal(releaseUrl);
        return { success: true };
      } catch {
        return { success: false, code: 'OPEN_RELEASE_PAGE_FAILED' };
      }
    }],
    ['get-workspaces', () => workspaceService.list()],
    ['create-workspace', (_event, payload) => workspaceRequest(() => (
      workspaceService.create(workspacePayload(payload))
    ))],
    ['rename-workspace', (_event, payload) => workspaceRequest(() => {
      const request = workspacePayload(payload);
      return workspaceService.rename({
        workspaceId: validateWorkspaceId(request.workspaceId),
        name: request.name,
      });
    })],
    ['delete-workspace', (_event, payload) => workspaceRequest(() => {
      const request = workspacePayload(payload);
      return workspaceService.remove({ workspaceId: validateWorkspaceId(request.workspaceId) });
    })],
    ['assign-profile-workspace', (_event, payload) => workspaceRequest(() => {
      const request = workspacePayload(payload);
      return workspaceService.assign({
        profileId: validateProfileId(request.profileId),
        workspaceId: validateWorkspaceIdOrNull(request.workspaceId),
      });
    })],
    ['assign-profiles-workspace', (_event, payload) => runBatchProfileRequest(
      batchWorkspaceRequest,
      payload,
      (request) => workspaceService.assignMany(request),
    )],
    ['set-profile-favorite', (_event, payload) => workspaceRequest(() => {
      const request = workspacePayload(payload);
      if (typeof request.favorite !== 'boolean') {
        throw new Error('Invalid favorite value');
      }
      return workspaceService.setFavorite({
        profileId: validateProfileId(request.profileId),
        favorite: request.favorite,
      });
    })],
    ['set-profiles-favorite', (_event, payload) => runBatchProfileRequest(
      batchFavoriteRequest,
      payload,
      (request) => workspaceService.setFavoriteMany(request),
    )],
    ['inspect-profile-diagnostics', (_event, profileId) => {
      const validatedProfileId = validateProfileId(profileId);
      return diagnosticsRequest(() => diagnosticsService.inspect(validatedProfileId));
    }],
    ['repair-profile-directory', (_event, profileId) => {
      const validatedProfileId = validateProfileId(profileId);
      return diagnosticsRepairRequest(() => (
        diagnosticsService.repairMissingDirectory(validatedProfileId)
      ));
    }],
  ]);

  for (const [channel, handler] of channels) {
    ipcMain.handle(channel, async (...args) => {
      try {
        return sanitizeResult(channel, await handler(...args), args);
      } catch {
        return fallbackResult(channel, args);
      }
    });
  }

  return function unregister() {
    for (const channel of channels.keys()) {
      ipcMain.removeHandler(channel);
    }
  };
}

module.exports = { registerIpcHandlers };
