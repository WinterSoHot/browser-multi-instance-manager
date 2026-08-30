(function attachImportPreview(root) {
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/gu, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    })[character]);
  }

  function buildImportDecisions(preview, defaultConflictMode) {
    if (!preview || !Array.isArray(preview.duplicates)) return [];
    if (defaultConflictMode !== 'skip' && defaultConflictMode !== 'rename') return [];
    return preview.duplicates.map((row) => ({ line: row.line, action: defaultConflictMode }));
  }

  function hasValidImportToken(preview) {
    return preview?.code === 'OK' && /^[a-f0-9]{64}$/u.test(preview.token || '');
  }

  function isConfirmableImportPreview(preview) {
    return hasValidImportToken(preview)
      && Array.isArray(preview.invalid)
      && preview.invalid.length === 0;
  }

  function createImportPreviewState() {
    let preview = null;
    let executingToken = null;

    return {
      open(nextPreview) {
        if (preview || executingToken || !hasValidImportToken(nextPreview)) return false;
        preview = nextPreview;
        return true;
      },
      startExecute() {
        if (!preview || executingToken || !isConfirmableImportPreview(preview)) return null;
        executingToken = preview.token;
        return { token: executingToken };
      },
      finish(token) {
        if (!executingToken || token !== executingToken) return false;
        preview = null;
        executingToken = null;
        return true;
      },
      close() {
        if (!preview || executingToken) return false;
        preview = null;
        return true;
      },
      canCancel() {
        return Boolean(preview) && !executingToken;
      },
      getSnapshot() {
        return { preview, executingToken };
      },
    };
  }

  function rowMarkup(rows, type) {
    return rows.map((row) => {
      const detail = type === 'invalid'
        ? `无效元数据（${escapeHtml(row.code)}）`
        : `${escapeHtml(row.browserType)} · ${escapeHtml(row.name)}`;
      return `<li>第 ${escapeHtml(row.line)} 行：${detail}</li>`;
    }).join('');
  }

  function renderImportPreview(preview) {
    const valid = Array.isArray(preview?.valid) ? preview.valid : [];
    const duplicates = Array.isArray(preview?.duplicates) ? preview.duplicates : [];
    const invalid = Array.isArray(preview?.invalid) ? preview.invalid : [];
    return [
      `<p class="import-preview-counts">可导入 <span id="importPreviewValidCount">${valid.length}</span>，重复 <span id="importPreviewDuplicateCount">${duplicates.length}</span>，无效 <span id="importPreviewInvalidCount">${invalid.length}</span></p>`,
      `<ul class="import-preview-rows">${rowMarkup(valid, 'valid')}${rowMarkup(duplicates, 'duplicate')}${rowMarkup(invalid, 'invalid')}</ul>`,
      `<button id="confirmImportPreview" type="button" class="btn btn-primary"${isConfirmableImportPreview(preview) ? '' : ' disabled'}>确认导入</button>`,
    ].join('');
  }

  const api = {
    buildImportDecisions,
    createImportPreviewState,
    hasValidImportToken,
    isConfirmableImportPreview,
    renderImportPreview,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ImportPreview = api;
}(typeof window === 'undefined' ? globalThis : window));
