const { createHash, randomUUID } = require('node:crypto');
const {
  createCloneProfileName,
  createProfileRecord,
  isDuplicateProfileName,
  validateProfileInput,
} = require('./profile-utils');

const IMPORT_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEW_TOKENS = 100;

function toMilliseconds(value) {
  if (typeof value === 'number') return value;
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : Date.now();
}

function normalizeDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  if (document.version !== 1 || !Array.isArray(document.profiles) || document.profiles.length > 1000) {
    return null;
  }
  return {
    version: 1,
    profiles: document.profiles.map((profile) => ({
      browserType: profile?.browserType,
      name: profile?.name,
    })),
  };
}

function digestDocument(document) {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

function createImportExportService({
  appStore,
  profileOperations,
  getProfilePath,
  createProfileDir,
  pathExists,
  removeEmptyDirectory,
  now = () => Date.now(),
  maxPreviewTokens = MAX_PREVIEW_TOKENS,
} = {}) {
  const tokens = new Map();

  function cleanupExpiredTokens() {
    const currentTime = toMilliseconds(now());
    for (const [token, record] of tokens) {
      if (record.expiresAt <= currentTime) tokens.delete(token);
    }
  }

  function invalidPreview(code, invalid) {
    return {
      code,
      token: null,
      documentDigest: null,
      valid: [],
      duplicates: [],
      invalid,
    };
  }

  function previewImport(document) {
    cleanupExpiredTokens();
    const normalizedDocument = normalizeDocument(document);
    if (!normalizedDocument) {
      return invalidPreview('INVALID_IMPORT_DOCUMENT', [{ line: null, code: 'INVALID_IMPORT_DOCUMENT' }]);
    }

    const currentProfiles = appStore.getProfiles();
    const previewProfiles = [...currentProfiles];
    const valid = [];
    const duplicates = [];
    const invalid = [];
    const rows = [];

    normalizedDocument.profiles.forEach((metadata, index) => {
      const line = index + 1;
      try {
        validateProfileInput(metadata.browserType, metadata.name);
      } catch {
        invalid.push({ line, code: 'INVALID_PROFILE_METADATA' });
        return;
      }

      const row = { line, browserType: metadata.browserType, name: metadata.name };
      rows.push(row);
      if (isDuplicateProfileName(previewProfiles, row.browserType, row.name)) {
        duplicates.push(row);
        return;
      }
      valid.push(row);
      previewProfiles.push(row);
    });

    if (tokens.size >= maxPreviewTokens) {
      return {
        code: 'IMPORT_PREVIEW_CAPACITY_REACHED',
        token: null,
        documentDigest: digestDocument(normalizedDocument),
        valid,
        duplicates,
        invalid,
      };
    }

    const documentDigest = digestDocument(normalizedDocument);
    const token = createHash('sha256')
      .update(`${documentDigest}:${randomUUID()}`)
      .digest('hex');
    tokens.set(token, {
      documentDigest,
      rows,
      duplicateLines: duplicates.map((row) => row.line),
      invalid,
      expiresAt: toMilliseconds(now()) + IMPORT_TOKEN_TTL_MS,
      state: 'active',
    });
    return { code: 'OK', token, documentDigest, valid, duplicates, invalid };
  }

  function parseDecisions(decisions) {
    if (!Array.isArray(decisions)) return null;
    const parsed = new Map();
    for (const decision of decisions) {
      if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return null;
      if (
        Object.keys(decision).some((key) => key !== 'line' && key !== 'action')
        || !Number.isInteger(decision.line)
        || decision.line < 1
        || (decision.action !== 'skip' && decision.action !== 'rename')
        || parsed.has(decision.line)
      ) {
        return null;
      }
      parsed.set(decision.line, decision.action);
    }
    return parsed;
  }

  async function executeImport({ token, decisions } = {}) {
    cleanupExpiredTokens();
    if (typeof token !== 'string' || token.length !== 64) {
      return { success: false, code: 'IMPORT_TOKEN_INVALID' };
    }
    const record = tokens.get(token);
    if (!record) return { success: false, code: 'IMPORT_TOKEN_EXPIRED' };
    if (record.state !== 'active') return { success: false, code: 'IMPORT_TOKEN_REPLAYED' };
    const parsedDecisions = parseDecisions(decisions);
    if (!parsedDecisions) return { success: false, code: 'IMPORT_DECISIONS_INVALID' };
    if (record.invalid.length > 0) return { success: false, code: 'IMPORT_PREVIEW_INVALID' };
    if (
      parsedDecisions.size !== record.duplicateLines.length
      || record.duplicateLines.some((line) => !parsedDecisions.has(line))
    ) {
      return { success: false, code: 'IMPORT_DECISIONS_INVALID' };
    }

    record.state = 'executing';
    try {
      return await profileOperations.runGlobalMutation(async () => {
        let originalProfiles = [];
        let hasOriginalSnapshot = false;
        const createdDirectories = [];
        try {
          originalProfiles = appStore.getProfiles();
          hasOriginalSnapshot = true;
          const plannedProfiles = [...originalProfiles];
          const plannedDirectories = [];

          for (const row of record.rows) {
            const wasDuplicateAtPreview = record.duplicateLines.includes(row.line);
            const isDuplicateNow = isDuplicateProfileName(
              plannedProfiles,
              row.browserType,
              row.name,
            );
            if (!wasDuplicateAtPreview && isDuplicateNow) {
              return { success: false, code: 'IMPORT_PREVIEW_STALE' };
            }

            let profileName = row.name;
            if (wasDuplicateAtPreview) {
              const action = parsedDecisions.get(row.line);
              if (action === 'skip') continue;
              profileName = createCloneProfileName(plannedProfiles, row.browserType, row.name);
            }
            plannedProfiles.push({ browserType: row.browserType, name: profileName });
            plannedDirectories.push({ browserType: row.browserType, profileName });
          }

          for (const plan of plannedDirectories) {
            plan.profilePath = getProfilePath
              ? getProfilePath(plan.browserType, plan.profileName)
              : null;
            if (!plan.profilePath) throw new Error('Profile path unavailable');
            plan.existedBefore = await pathExists(plan.profilePath);
          }

          const imported = [];
          for (const plan of plannedDirectories) {
            const createdPath = await createProfileDir(plan.browserType, plan.profileName);
            if (!plan.existedBefore) createdDirectories.push(plan.profilePath);
            const profile = createProfileRecord({
              browserType: plan.browserType,
              profileName: plan.profileName,
              profilePath: createdPath,
            });
            imported.push(profile);
          }
          appStore.setProfiles([...originalProfiles, ...imported]);
          return { success: true, code: 'OK', profiles: imported };
        } catch {
          let rollbackIncomplete = !hasOriginalSnapshot;
          if (hasOriginalSnapshot) {
            try {
              appStore.setProfiles(originalProfiles);
            } catch {
              rollbackIncomplete = true;
            }
          }
          for (const directoryPath of createdDirectories.reverse()) {
            try {
              if (await pathExists(directoryPath)) await removeEmptyDirectory(directoryPath);
            } catch {
              rollbackIncomplete = true;
            }
          }
          return {
            success: false,
            code: rollbackIncomplete ? 'IMPORT_ROLLBACK_INCOMPLETE' : 'IMPORT_EXECUTION_FAILED',
          };
        }
      });
    } catch {
      return { success: false, code: 'IMPORT_EXECUTION_FAILED' };
    } finally {
      record.state = 'consumed';
    }
  }

  return { previewImport, executeImport };
}

module.exports = {
  createImportExportService,
  IMPORT_TOKEN_TTL_MS,
  MAX_PREVIEW_TOKENS,
};
