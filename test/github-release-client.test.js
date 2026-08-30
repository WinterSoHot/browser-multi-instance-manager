const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

let githubReleaseClient = {};
try {
  githubReleaseClient = require('../lib/github-release-client');
} catch {
  // The first TDD run intentionally exercises the missing module.
}

const createGithubReleaseClient = githubReleaseClient.createGithubReleaseClient || (() => async () => {
  throw new Error('GITHUB_RELEASE_CLIENT_UNAVAILABLE');
});
const GITHUB_LATEST_RELEASE_URL = githubReleaseClient.GITHUB_LATEST_RELEASE_URL
  || 'missing://github-release-client';
const MAX_RELEASE_BODY_BYTES = githubReleaseClient.MAX_RELEASE_BODY_BYTES || 256 * 1024;

function createRequestHarness(onRequest) {
  const calls = [];
  const request = (url, options, onResponse) => {
    const req = new EventEmitter();
    req.destroyCalls = 0;
    req.endCalls = 0;
    req.destroy = () => { req.destroyCalls += 1; };
    req.end = () => {
      req.endCalls += 1;
      onRequest({ url, options, onResponse, req });
    };
    calls.push({ url, options, req });
    return req;
  };
  return { request, calls };
}

function createResponse({
  statusCode = 200,
  headers = { 'content-type': 'application/json' },
  chunks = [],
  error = null,
} = {}) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.headers = headers;
  response.destroyCalls = 0;
  response.destroy = () => { response.destroyCalls += 1; };
  response.start = () => queueMicrotask(() => {
    for (const chunk of chunks) response.emit('data', chunk);
    if (error) response.emit('error', error);
    else response.emit('end');
  });
  return response;
}

function assertStableRejection(promise, code, unsafeValue = '') {
  return assert.rejects(promise, (error) => (
    error?.code === code
    && error.message === code
    && (unsafeValue === '' || !error.message.includes(unsafeValue))
  ));
}

test('fixed GitHub client sends only the latest-release GET with explicit headers and signal', async () => {
  const response = createResponse({
    headers: { 'content-type': 'application/vnd.github+json; charset=utf-8' },
    chunks: [Buffer.from('{"tag_name":"v1.4.0"}')],
  });
  const harness = createRequestHarness(({ onResponse }) => {
    onResponse(response);
    response.start();
  });
  const requestLatestRelease = createGithubReleaseClient({ request: harness.request });
  const controller = new AbortController();

  assert.deepEqual(await requestLatestRelease({ signal: controller.signal }), { tag_name: 'v1.4.0' });
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].url, GITHUB_LATEST_RELEASE_URL);
  assert.equal(harness.calls[0].options.method, 'GET');
  assert.match(harness.calls[0].options.headers.Accept, /json/u);
  assert.match(harness.calls[0].options.headers['User-Agent'], /browser-multi-instance-manager/u);
  assert.equal(harness.calls[0].options.signal, controller.signal);
});

test('fixed GitHub client rejects redirects, rate limits, other HTTP statuses, and non-JSON content', async () => {
  const cases = [
    { statusCode: 302, headers: {}, code: 'UPDATE_CHECK_REDIRECT' },
    { statusCode: 403, headers: {}, code: 'UPDATE_CHECK_RATE_LIMITED' },
    { statusCode: 429, headers: {}, code: 'UPDATE_CHECK_RATE_LIMITED' },
    { statusCode: 500, headers: {}, code: 'UPDATE_CHECK_HTTP_ERROR' },
    { statusCode: 200, headers: { 'content-type': 'text/html' }, code: 'UPDATE_CHECK_RESPONSE_INVALID' },
  ];

  for (const item of cases) {
    const response = createResponse(item);
    const harness = createRequestHarness(({ onResponse }) => onResponse(response));
    const requestLatestRelease = createGithubReleaseClient({ request: harness.request });

    await assertStableRejection(requestLatestRelease({}), item.code, 'body');
    assert.equal(response.destroyCalls, 1);
  }
});

test('fixed GitHub client enforces content-length and streamed raw-byte limits', async () => {
  const declaredTooLarge = createResponse({
    headers: { 'content-type': 'application/json', 'content-length': String(MAX_RELEASE_BODY_BYTES + 1) },
  });
  const declaredHarness = createRequestHarness(({ onResponse }) => onResponse(declaredTooLarge));
  await assertStableRejection(
    createGithubReleaseClient({ request: declaredHarness.request })({}),
    'UPDATE_CHECK_RESPONSE_TOO_LARGE',
  );
  assert.equal(declaredTooLarge.destroyCalls, 1);

  const streamedTooLarge = createResponse({
    chunks: [Buffer.alloc(MAX_RELEASE_BODY_BYTES), Buffer.from('x')],
  });
  const streamedHarness = createRequestHarness(({ onResponse }) => {
    onResponse(streamedTooLarge);
    streamedTooLarge.start();
  });
  await assertStableRejection(
    createGithubReleaseClient({ request: streamedHarness.request })({}),
    'UPDATE_CHECK_RESPONSE_TOO_LARGE',
  );
  assert.equal(streamedTooLarge.destroyCalls, 1);
});

test('fixed GitHub client maps parse, request, response, and abort failures without leaking bodies', async () => {
  const invalidJson = createResponse({ chunks: [Buffer.from('{secret-body')] });
  const parseHarness = createRequestHarness(({ onResponse }) => {
    onResponse(invalidJson);
    invalidJson.start();
  });
  await assertStableRejection(
    createGithubReleaseClient({ request: parseHarness.request })({}),
    'UPDATE_CHECK_RESPONSE_INVALID',
    'secret-body',
  );

  const errorHarness = createRequestHarness(({ req }) => queueMicrotask(() => req.emit('error', new Error('/private/body'))));
  await assertStableRejection(
    createGithubReleaseClient({ request: errorHarness.request })({}),
    'UPDATE_CHECK_NETWORK_ERROR',
    '/private/body',
  );

  const abortHarness = createRequestHarness(() => {});
  const requestLatestRelease = createGithubReleaseClient({ request: abortHarness.request });
  const controller = new AbortController();
  const pending = requestLatestRelease({ signal: controller.signal });
  controller.abort();
  abortHarness.calls[0].req.emit('error', new Error('late network error'));
  await assertStableRejection(pending, 'UPDATE_CHECK_ABORTED');
  assert.equal(abortHarness.calls[0].req.destroyCalls, 1);
});

test('fixed GitHub client maps an aborted or prematurely closed response to one network failure', async () => {
  for (const event of ['aborted', 'close']) {
    const response = createResponse();
    const harness = createRequestHarness(({ onResponse }) => {
      onResponse(response);
      queueMicrotask(() => response.emit(event));
    });

    await assertStableRejection(
      createGithubReleaseClient({ request: harness.request })({}),
      'UPDATE_CHECK_NETWORK_ERROR',
    );
    assert.equal(response.destroyCalls, 1);
  }
});

test('fixed GitHub client maps synchronous request failures to a stable error', async () => {
  const requestLatestRelease = createGithubReleaseClient({
    request: () => { throw new Error('/private/request-path'); },
  });

  await assertStableRejection(requestLatestRelease({}), 'UPDATE_CHECK_NETWORK_ERROR', '/private/request-path');
});
