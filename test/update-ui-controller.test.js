const test = require('node:test');
const assert = require('node:assert/strict');

const { createUpdateUiController } = require('../renderer/update-ui-controller');

const releaseUrl = 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.4.0';

test('update controller single-flights manual checks and retains only a safe available release', async () => {
  let resolveCheck;
  let calls = 0;
  const rendered = [];
  const controller = createUpdateUiController({
    checkForUpdates(force) {
      calls += 1;
      assert.equal(force, true);
      return new Promise((resolve) => { resolveCheck = resolve; });
    },
    openReleasePage: async () => ({ success: true }),
    render: (state) => rendered.push(state),
  });

  const first = controller.check(true);
  const second = controller.check(true);
  assert.equal(calls, 1);
  assert.equal(await second, null);
  resolveCheck({ status: 'available', version: '1.4.0', releaseUrl });
  assert.deepEqual(await first, { status: 'available', version: '1.4.0', releaseUrl });
  assert.deepEqual(controller.getAvailable(), { version: '1.4.0', releaseUrl });
  assert.equal(rendered.at(-1).busy, false);
});

test('update controller makes malformed data and open failures stable without retaining URLs', async () => {
  const controller = createUpdateUiController({
    checkForUpdates: async () => ({ status: 'available', version: '1.4.0', releaseUrl: 'https://evil.example' }),
    openReleasePage: async () => { throw new Error('/private/path'); },
    render: () => {},
  });

  assert.deepEqual(await controller.check(true), { status: 'error', code: 'UPDATE_CHECK_REQUEST_FAILED' });
  assert.equal(controller.getAvailable(), null);
  assert.deepEqual(await controller.openAvailable(), { success: false, code: 'OPEN_RELEASE_PAGE_FAILED' });
});

test('an error keeps an already validated available notice, while a newer version resets dismissal', async () => {
  let result = { status: 'available', version: '1.4.0', releaseUrl };
  const opened = [];
  const controller = createUpdateUiController({
    checkForUpdates: async () => result,
    openReleasePage: async (url) => { opened.push(url); return { success: true }; },
    render: () => {},
  });

  await controller.check(false);
  controller.dismiss();
  result = { status: 'error', code: 'UPDATE_CHECK_NETWORK_ERROR' };
  assert.deepEqual(await controller.check(true), result);
  assert.deepEqual(controller.getAvailable(), { version: '1.4.0', releaseUrl });
  assert.deepEqual(await controller.openAvailable(), { success: true });
  assert.deepEqual(opened, [releaseUrl]);
  result = {
    status: 'available',
    version: '1.5.0',
    releaseUrl: 'https://github.com/WinterSoHot/browser-multi-instance-manager/releases/tag/v1.5.0',
  };
  await controller.check(true);
  assert.equal(controller.shouldShowNotice(), true);
});

test('accept updates state from an automatic event without requesting again', () => {
  let requests = 0;
  const controller = createUpdateUiController({
    checkForUpdates: async () => { requests += 1; return { status: 'current' }; },
    openReleasePage: async () => ({ success: true }),
    render: () => {},
  });

  assert.deepEqual(controller.accept({ status: 'available', version: '1.4.0', releaseUrl }), {
    status: 'available', version: '1.4.0', releaseUrl,
  });
  assert.equal(requests, 0);
  assert.deepEqual(controller.getAvailable(), { version: '1.4.0', releaseUrl });
});

test('update controller can dismiss one available version for this session', async () => {
  const controller = createUpdateUiController({
    checkForUpdates: async () => ({ status: 'available', version: '1.4.0', releaseUrl }),
    openReleasePage: async () => ({ success: true }),
    render: () => {},
  });

  await controller.check(false);
  controller.dismiss();
  assert.equal(controller.shouldShowNotice(), false);
  await controller.check(true);
  assert.equal(controller.shouldShowNotice(), false);
});
