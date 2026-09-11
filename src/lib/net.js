// The only fetch in the codebase (rule 5: rate limits are account safety, not
// politeness). One promise chain per host serialises every request to that host;
// a per-path last-request map enforces the endpoint's own minimum interval on top of
// the host floor. Never retries 401/403 (the key is wrong, revoked or lacks a scope —
// the user has to act). Never logs, stores or rethrows the Authorization header value
// or the auth object; both are read only inside throttledFetch.

import { RATE, API_PREFIX, HOSTS } from './config.js';
import { LetoError } from './errors.js';

/** @typedef {{ key:string, secret:string }} Cred */

let fetchImpl = globalThis.fetch;

/** One tail promise per host origin; always resolves, never rejects, so it can be
 * chained onto forever regardless of what any individual request did. */
const hostQueues = new Map();
/** origin -> epoch ms of the last request actually sent to that host. */
const hostLastRequest = new Map();
/** origin+pathname -> epoch ms of the last request actually sent to that path. */
const pathLastRequest = new Map();

class TimeoutSignal extends Error {}

/** Swap the fetch implementation for tests. @param {typeof fetch} fn */
export function _setFetch(fn) {
  fetchImpl = fn;
}

/** Clears queues and last-request maps between tests. */
export function _resetForTests() {
  hostQueues.clear();
  hostLastRequest.clear();
  pathLastRequest.clear();
}

/**
 * Encodes a UTF-8 string to base64 without assuming a DOM btoa is available.
 * @param {string} str
 * @returns {string}
 */
function toBase64(str) {
  // Hand-rolled: `Buffer` does not exist in a service worker and `btoa` was found
  // absent in one Chromium worker global during the end-to-end test. UTF-8 first.
  const bytes = new TextEncoder().encode(str);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += alphabet[(triple >> 18) & 63] + alphabet[(triple >> 12) & 63];
    out += b1 === undefined ? '=' : alphabet[(triple >> 6) & 63];
    out += b2 === undefined ? '=' : alphabet[triple & 63];
  }
  return out;
}

/**
 * Pure: builds the `Authorization: Basic ...` header value for a credential.
 * @param {Cred} cred
 * @returns {string}
 */
export function basicAuthHeader(cred) {
  return `Basic ${toBase64(`${cred.key}:${cred.secret}`)}`;
}

/**
 * Pure: joins a host base with a path and query params. Appends API_PREFIX when
 * hostBase is one of the Trading 212 API hosts (live/demo), not for the charting host.
 * @param {string} hostBase
 * @param {string} path
 * @param {Record<string, string|number|undefined|null>} [params]
 * @returns {string}
 */
export function buildUrl(hostBase, path, params = {}) {
  const isApiHost = hostBase === HOSTS.live || hostBase === HOSTS.demo;
  const fullPath = isApiHost ? `${API_PREFIX}${path}` : path;
  const url = new URL(fullPath, hostBase);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Races a promise against a deadline; aborts `controller` and rejects with
 * TimeoutSignal if the deadline wins. Fake fetches that ignore the abort signal still
 * time out correctly because the race itself decides the outcome. */
function withTimeout(promise, ms, controller) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutSignal('deadline exceeded'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Backoff for retry index n (0-based): backoffBaseMs * 2^n, capped. */
function backoffDelay(n) {
  return Math.min(RATE.backoffBaseMs * 2 ** n, RATE.backoffCapMs);
}

/** Waits out whichever of the host floor or the per-path minimum is not yet elapsed,
 * then records this moment as the last request for both. */
async function waitForSlot(origin, pathKey, minMs) {
  const now = Date.now();
  const hostLast = hostLastRequest.has(origin) ? hostLastRequest.get(origin) : -Infinity;
  const pathLast = pathLastRequest.has(pathKey) ? pathLastRequest.get(pathKey) : -Infinity;
  const hostWait = RATE.hostFloorMs - (now - hostLast);
  const pathWait = minMs - (now - pathLast);
  const wait = Math.max(hostWait, pathWait, 0);
  if (wait > 0) await sleep(wait);
  const at = Date.now();
  hostLastRequest.set(origin, at);
  pathLastRequest.set(pathKey, at);
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function shortText(text) {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return undefined;
  return trimmed;
}

/** Chains `task` onto the host's tail so requests to the same host never overlap;
 * the tail itself always resolves so a failed task never blocks the next one. */
function enqueue(origin, task) {
  const previousTail = hostQueues.get(origin) || Promise.resolve();
  const run = previousTail.then(task, task);
  hostQueues.set(
    origin,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

async function runRequest({ url, headers, minMs, deadlineMs, origin, pathKey }) {
  let timedOutOnce = false;
  for (let attempt = 0; ; attempt++) {
    await waitForSlot(origin, pathKey, minMs);

    const controller = new AbortController();
    let res;
    try {
      res = await withTimeout(
        fetchImpl(url, { method: 'GET', headers, signal: controller.signal }),
        deadlineMs,
        controller,
      );
    } catch (err) {
      if (err instanceof TimeoutSignal) {
        if (timedOutOnce) {
          throw new LetoError('UPSTREAM_ERROR', { status: 'timeout' }, 'request timed out twice');
        }
        timedOutOnce = true;
        continue;
      }
      throw new LetoError('UPSTREAM_ERROR', {}, err && err.message ? err.message : 'fetch failed');
    }

    const status = res.status;
    if (status >= 200 && status < 300) {
      const json = await res.json();
      return { status, json, headers: res.headers };
    }
    if (status === 401) {
      throw new LetoError('KEY_INVALID', {}, 'HTTP 401');
    }
    if (status === 403) {
      const scope = shortText(await safeText(res));
      throw new LetoError('KEY_SCOPE_MISSING', { scope }, 'HTTP 403');
    }

    const retryable = status === 429 || status === 408 || (status >= 500 && status <= 599);
    if (retryable && attempt < RATE.maxRetries) {
      await sleep(backoffDelay(attempt));
      continue;
    }
    if (status === 429) {
      throw new LetoError('RATE_LIMITED', {}, 'HTTP 429');
    }
    if (status >= 500 && status <= 599) {
      throw new LetoError('UPSTREAM_ERROR', { status }, `HTTP ${status}`);
    }
    // 408 exhausted, or any other non-retryable 4xx.
    throw new LetoError('UPSTREAM_ERROR', { status }, `HTTP ${status}`);
  }
}

/**
 * @param {string} url
 * @param {{ auth?: Cred|null, minMs?: number, deadlineMs?: number, method?: string }} [opts]
 * @returns {Promise<{ status:number, json:unknown, headers:object }>}
 */
export async function throttledFetch(url, opts = {}) {
  const { auth = null, minMs = 0, deadlineMs = RATE.deadlineMs, method = 'GET' } = opts;

  if (method !== 'GET') {
    throw new LetoError('WRITE_FORBIDDEN', {}, 'net.js issues GET requests only (rule 1)');
  }

  const parsed = new URL(url);
  const origin = parsed.origin;
  const pathKey = origin + parsed.pathname;

  const headers = { Accept: 'application/json' };
  if (auth) {
    headers.Authorization = basicAuthHeader(auth);
  }

  return enqueue(origin, () => runRequest({ url, headers, minMs, deadlineMs, origin, pathKey }));
}
