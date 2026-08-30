const MAX_STATUS_PROFILE_IDS = 1000;
const MAX_IMPORT_FILE_BYTES = 1024 * 1024;

function validateProfileId(profileId) {
  if (typeof profileId !== 'string' || profileId.trim() === '') {
    throw new Error('Invalid profile ID');
  }
  return profileId;
}

function validateProfileIds(profileIds, maxItems = MAX_STATUS_PROFILE_IDS) {
  if (!Array.isArray(profileIds)) {
    throw new Error('Profile IDs must be an array');
  }
  if (profileIds.length > maxItems) {
    throw new Error(`Profile status requests support at most ${maxItems} IDs`);
  }
  return [...new Set(profileIds.map(validateProfileId))];
}

function validateImportFileSize(size, maxBytes = MAX_IMPORT_FILE_BYTES) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Import file size is invalid');
  }
  if (size > maxBytes) {
    throw new Error('Import file is too large');
  }
  return size;
}

module.exports = {
  MAX_IMPORT_FILE_BYTES,
  MAX_STATUS_PROFILE_IDS,
  validateImportFileSize,
  validateProfileId,
  validateProfileIds,
};
