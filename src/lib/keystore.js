// The only reader and writer of chrome.storage.local[CREDENTIAL_KEY] (rule 1: one
// read-only key, one place, never outward). Never logs the key or secret; `describe()`
// exists so diagnostics can mention that a credential is present without exposing it.
// This module may not import net.js, store.js or anything that could forward the
// credential elsewhere.

import { CREDENTIAL_KEY } from './config.js';
import { LetoError } from './errors.js';

let chromeRef = globalThis.chrome;

/**
 * Swap in a chrome-like object for tests. Defaults to globalThis.chrome.
 * @param {{ storage: { local: object } }} chromeLike
 */
export function setChrome(chromeLike) {
  chromeRef = chromeLike;
}

/**
 * @typedef {{ key:string, secret:string, env:'live'|'demo' }} Credential
 */

/**
 * Trims whitespace off key and secret; rejects either when empty after trimming.
 * @param {{ key:string, secret:string, env:'live'|'demo' }} cred
 * @returns {Promise<void>}
 */
export async function save({ key, secret, env }) {
  const trimmedKey = typeof key === 'string' ? key.trim() : '';
  const trimmedSecret = typeof secret === 'string' ? secret.trim() : '';
  if (!trimmedKey || !trimmedSecret) {
    throw new LetoError('KEY_INVALID', {}, 'key or secret empty after trim');
  }
  if (env !== 'live' && env !== 'demo') {
    throw new LetoError('KEY_INVALID', {}, 'env must be live or demo');
  }
  await chromeRef.storage.local.set({
    [CREDENTIAL_KEY]: { key: trimmedKey, secret: trimmedSecret, env },
  });
}

/** @returns {Promise<Credential|null>} */
export async function load() {
  const result = await chromeRef.storage.local.get(CREDENTIAL_KEY);
  const cred = result ? result[CREDENTIAL_KEY] : undefined;
  return cred ?? null;
}

/** @returns {Promise<void>} */
export async function clear() {
  await chromeRef.storage.local.remove(CREDENTIAL_KEY);
}

/**
 * Diagnostics-safe view of a credential: never the key or secret themselves.
 * @param {Credential|null} cred
 * @returns {{ env:string, keyLength:number }|null}
 */
export function describe(cred) {
  if (!cred) return null;
  return { env: cred.env, keyLength: typeof cred.key === 'string' ? cred.key.length : 0 };
}
