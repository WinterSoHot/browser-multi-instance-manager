const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserSettingsService } = require('../lib/browser-settings-service');

function createFixture({
  initialSettings = { chrome: '/custom/chrome' },
  existingPaths = ['/custom/chrome', '/detected/firefox'],
} = {}) {
  let settings = structuredClone(initialSettings);
  const reads = [];
  const writes = [];
  const service = createBrowserSettingsService({
    appStore: {
      getBrowserSettings() {
        reads.push('browserSettings');
        return structuredClone(settings);
      },
      setBrowserSettings(nextSettings) {
        writes.push(structuredClone(nextSettings));
        settings = structuredClone(nextSettings);
      },
    },
    enqueueMutation: (operation) => operation(),
    normalizeExecutablePath: (_browserType, executablePath) => executablePath,
    resolveInstalledPath: (browserType) => (
      browserType === 'firefox' ? '/detected/firefox' : null
    ),
    validateSettings(nextSettings) {
      if (!nextSettings || Array.isArray(nextSettings)) {
        throw new Error('Invalid browser settings');
      }
      return structuredClone(nextSettings);
    },
    pathExists: async (targetPath) => existingPaths.includes(targetPath),
    getPlatform: () => 'test-platform',
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  });

  return { service, reads, writes };
}

test('browser settings reads and executable resolution use the app store adapter', () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.service.get(), { chrome: '/custom/chrome' });
  assert.equal(fixture.service.getExecutable('chrome'), '/custom/chrome');
  assert.equal(fixture.service.getExecutable('firefox'), '/detected/firefox');
  assert.deepEqual(fixture.reads, ['browserSettings', 'browserSettings', 'browserSettings']);
});

test('validated browser settings writes use the app store adapter', async () => {
  const fixture = createFixture();

  assert.deepEqual(
    await fixture.service.set({ chrome: '/custom/chrome', firefox: '/detected/firefox' }),
    { success: true },
  );
  assert.deepEqual(fixture.writes, [{
    chrome: '/custom/chrome',
    firefox: '/detected/firefox',
  }]);
});

test('browser environment reads settings through the app store adapter', async () => {
  const fixture = createFixture();

  assert.deepEqual(await fixture.service.getEnvironment(), {
    platform: 'test-platform',
    settings: { chrome: '/custom/chrome' },
    defaultPaths: {
      chrome: null,
      firefox: '/detected/firefox',
      edge: null,
      zen: null,
    },
    validity: {
      chrome: true,
      firefox: true,
      edge: false,
      zen: false,
    },
  });
  assert.deepEqual(fixture.reads, ['browserSettings']);
});
