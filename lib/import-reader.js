const fsp = require('node:fs/promises');
const {
  MAX_IMPORT_FILE_BYTES,
  validateImportFileSize,
} = require('./ipc-validation');

async function readTextFileBounded(
  filePath,
  {
    maxBytes = MAX_IMPORT_FILE_BYTES,
    openFile = (targetPath) => fsp.open(targetPath, 'r'),
  } = {},
) {
  const file = await openFile(filePath);
  try {
    const fileStat = await file.stat();
    if (!fileStat.isFile()) throw new Error('Import path must be a regular file');
    validateImportFileSize(fileStat.size, maxBytes);

    const buffer = Buffer.alloc(maxBytes + 1);
    let bytesReadTotal = 0;
    while (bytesReadTotal < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        bytesReadTotal,
        buffer.length - bytesReadTotal,
        bytesReadTotal,
      );
      if (bytesRead === 0) break;
      bytesReadTotal += bytesRead;
    }
    validateImportFileSize(bytesReadTotal, maxBytes);
    return buffer.subarray(0, bytesReadTotal).toString('utf8');
  } finally {
    await file.close();
  }
}

module.exports = { readTextFileBounded };
