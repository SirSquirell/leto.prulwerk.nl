// IndexedDB wrapper with an injectable backend (rule 2: only raw responses are
// persisted truth; every derived number is a cache that can be deleted and rebuilt).
// `meta` is the one store that carries small derived state (sync status, counts,
// notices) rather than raw rows; `redactMeta` is the default-deny gate (rule 7) for
// anything from `meta` that leaves the machine.

import { DB } from './config.js';

/** meta keys allowed in an export or bug report; anything else becomes '[redacted]'. */
export const EXPORTABLE_META = Object.freeze([
  'lastSyncAt',
  'syncState',
  'currency',
  'counts',
  'notices',
  'version',
  'lastError',
]);

/**
 * @param {Record<string, unknown>} metaObject
 * @returns {Record<string, unknown>}
 */
export function redactMeta(metaObject) {
  const result = {};
  for (const [key, value] of Object.entries(metaObject || {})) {
    result[key] = EXPORTABLE_META.includes(key) ? value : '[redacted]';
  }
  return result;
}

/**
 * @param {{ backend?: object }} [opts] a fake backend (test/fake-indexeddb.js) or
 *   omitted to open real IndexedDB.
 */
export async function openStore({ backend } = {}) {
  const raw = backend || (await openIndexedDbBackend());
  return wrapBackend(raw);
}

/** Adds the operations a minimal backend (put/all/get/clear[/wipeAll]) does not have
 * to provide itself, so both the fake and the real IndexedDB backend can stay small. */
function wrapBackend(raw) {
  return {
    /** @param {string} store @param {object[]} rows */
    async put(store, rows) {
      return raw.put(store, rows);
    },
    /** @param {string} store */
    async all(store) {
      return raw.all(store);
    },
    /** @param {string} store @param {string} key */
    async get(store, key) {
      return raw.get(store, key);
    },
    /** @param {string} store */
    async clear(store) {
      return raw.clear(store);
    },
    /** @param {string} store */
    async count(store) {
      if (typeof raw.count === 'function') return raw.count(store);
      return (await raw.all(store)).length;
    },
    async wipeAll() {
      if (typeof raw.wipeAll === 'function') return raw.wipeAll();
      for (const store of Object.keys(DB.stores)) await raw.clear(store);
    },
    /** @param {string} key */
    async getMeta(key) {
      const row = await raw.get('meta', key);
      return row ? row.value : undefined;
    },
    /** @param {string} key @param {unknown} value */
    async setMeta(key, value) {
      return raw.put('meta', [{ key, value }]);
    },
    /** @param {string} key */
    async deleteMeta(key) {
      if (typeof raw.delete === 'function') return raw.delete('meta', key);
      const rows = await raw.all('meta');
      const kept = rows.filter((row) => row.key !== key);
      await raw.clear('meta');
      if (kept.length) await raw.put('meta', kept);
    },
  };
}

function openIndexedDbBackend() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, DB.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [store, keyPath] of Object.entries(DB.stores)) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath });
        }
      }
    };
    request.onsuccess = () => resolve(makeIndexedDbBackend(request.result));
    request.onerror = () => reject(request.error);
  });
}

function makeIndexedDbBackend(db) {
  function objectStore(store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }
  return {
    put(store, rows) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const row of rows) os.put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    all(store) {
      return new Promise((resolve, reject) => {
        const req = objectStore(store, 'readonly').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    get(store, key) {
      return new Promise((resolve, reject) => {
        const req = objectStore(store, 'readonly').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    clear(store) {
      return new Promise((resolve, reject) => {
        const req = objectStore(store, 'readwrite').clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    count(store) {
      return new Promise((resolve, reject) => {
        const req = objectStore(store, 'readonly').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    delete(store, key) {
      return new Promise((resolve, reject) => {
        const req = objectStore(store, 'readwrite').delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async wipeAll() {
      for (const store of Object.keys(DB.stores)) {
        await this.clear(store);
      }
    },
  };
}
