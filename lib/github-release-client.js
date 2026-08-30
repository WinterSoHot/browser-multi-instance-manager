const https = require('node:https');

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/WinterSoHot/browser-multi-instance-manager/releases/latest';
const MAX_RELEASE_BODY_BYTES = 256 * 1024;

function createClientError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isJsonContentType(headers) {
  const contentType = headers?.['content-type'];
  if (typeof contentType !== 'string') return false;
  return /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/iu.test(contentType);
}

function isOversizedContentLength(headers) {
  const contentLength = headers?.['content-length'];
  if (contentLength === undefined) return false;
  if (typeof contentLength !== 'string' || !/^[0-9]+$/u.test(contentLength)) return true;
  return Number(contentLength) > MAX_RELEASE_BODY_BYTES;
}

function createGithubReleaseClient({ request = https.request } = {}) {
  if (typeof request !== 'function') throw createClientError('UPDATE_CHECK_NETWORK_ERROR');

  return function requestLatestRelease({ signal } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let req = null;
      let response = null;

      function cleanup() {
        signal?.removeEventListener?.('abort', onAbort);
      }

      function settleResolve(value) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }

      function settleReject(code) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(createClientError(code));
      }

      function destroyResponse() {
        if (response && typeof response.destroy === 'function') response.destroy();
      }

      function onAbort() {
        settleReject('UPDATE_CHECK_ABORTED');
        if (req && typeof req.destroy === 'function') req.destroy();
        destroyResponse();
      }

      function onResponse(nextResponse) {
        response = nextResponse;
        if (settled) {
          destroyResponse();
          return;
        }

        function rejectResponse(code) {
          settleReject(code);
          destroyResponse();
        }

        if (response.statusCode === 403 || response.statusCode === 429) {
          rejectResponse('UPDATE_CHECK_RATE_LIMITED');
          return;
        }
        if (response.statusCode >= 300 && response.statusCode < 400) {
          rejectResponse('UPDATE_CHECK_REDIRECT');
          return;
        }
        if (response.statusCode !== 200) {
          rejectResponse('UPDATE_CHECK_HTTP_ERROR');
          return;
        }
        if (!isJsonContentType(response.headers) || isOversizedContentLength(response.headers)) {
          rejectResponse(isOversizedContentLength(response.headers)
            ? 'UPDATE_CHECK_RESPONSE_TOO_LARGE' : 'UPDATE_CHECK_RESPONSE_INVALID');
          return;
        }

        let size = 0;
        const chunks = [];
        response.once('error', () => rejectResponse('UPDATE_CHECK_NETWORK_ERROR'));
        response.once('aborted', () => rejectResponse('UPDATE_CHECK_NETWORK_ERROR'));
        let ended = false;
        response.on('data', (chunk) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_RELEASE_BODY_BYTES) {
            rejectResponse('UPDATE_CHECK_RESPONSE_TOO_LARGE');
            return;
          }
          chunks.push(bytes);
        });
        response.once('end', () => {
          if (settled) return;
          ended = true;
          try {
            settleResolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            settleReject('UPDATE_CHECK_RESPONSE_INVALID');
          }
        });
        response.once('close', () => {
          if (!ended) rejectResponse('UPDATE_CHECK_NETWORK_ERROR');
        });
      }

      try {
        req = request(GITHUB_LATEST_RELEASE_URL, {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'browser-multi-instance-manager',
          },
          signal,
        }, onResponse);
        req.once('error', () => settleReject('UPDATE_CHECK_NETWORK_ERROR'));
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener?.('abort', onAbort, { once: true });
        req.end();
      } catch {
        settleReject('UPDATE_CHECK_NETWORK_ERROR');
      }
    });
  };
}

module.exports = {
  GITHUB_LATEST_RELEASE_URL,
  MAX_RELEASE_BODY_BYTES,
  createGithubReleaseClient,
};
