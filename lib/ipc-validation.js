const MAX_STATUS_PROFILE_IDS = 1000;
const MAX_BATCH_PROFILE_IDS = 1000;
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

function validateBatchProfileIds(profileIds) {
  if (!Array.isArray(profileIds) || profileIds.length === 0) {
    throw new Error('Invalid batch profile IDs');
  }
  const seen = new Set();
  const validated = [];
  for (const profileId of profileIds) {
    const value = validateProfileId(profileId);
    if (seen.has(value)) continue;
    seen.add(value);
    validated.push(value);
    if (validated.length > MAX_BATCH_PROFILE_IDS) {
      throw new Error('Invalid batch profile IDs');
    }
  }
  return validated;
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
  MAX_BATCH_PROFILE_IDS,
  MAX_IMPORT_FILE_BYTES,
  MAX_STATUS_PROFILE_IDS,
  validateBatchProfileIds,
  validateImportFileSize,
  validateProfileId,
  validateProfileIds,
};
