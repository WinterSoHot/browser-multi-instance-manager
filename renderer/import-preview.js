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
      `<button id="confirmImportPreview" type="button" class="btn btn-primary"${invalid.length > 0 ? ' disabled' : ''}>确认导入</button>`,
    ].join('');
  }

  const api = { buildImportDecisions, renderImportPreview };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ImportPreview = api;
}(typeof window === 'undefined' ? globalThis : window));
