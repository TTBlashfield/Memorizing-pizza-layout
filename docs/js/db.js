// Tiny IndexedDB key-value store. Same database the service worker reads (see sw-push.js).
// Everything stays on this device.

export const DB_NAME = 'makeline';
export const DB_VERSION = 1;
export const STORE = 'kv';
export const SNAPSHOT_KEY = 'notify';
export const DATA_CACHE = 'makeline-data-v1';
export const SNAPSHOT_URL = '__notify.json';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so nothing can be saved.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('Storage is busy. Close other Makeline windows and try again.')); };
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store, (r) => { result = r; })).catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage write was cancelled.'));
  }));
}

export function kvGetMany(keys) {
  return run('readonly', (store, done) => {
    const out = {};
    keys.forEach((k) => {
      const r = store.get(k);
      r.onsuccess = () => { out[k] = r.result; };
    });
    done(out);
  });
}

export const kvGet = (key) => kvGetMany([key]).then((o) => o[key]);

export function kvSet(key, value) {
  return run('readwrite', (store) => { store.put(value, key); });
}

export function kvDel(key) {
  return run('readwrite', (store) => { store.delete(key); });
}

/** Ask the browser not to clear our storage under pressure (best effort). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

/** Save the notification snapshot where the service worker can read it (IDB + Cache backup). */
export async function saveSnapshot(snapshot) {
  await kvSet(SNAPSHOT_KEY, snapshot);
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(DATA_CACHE);
      await cache.put(new URL(SNAPSHOT_URL, document.baseURI).href, new Response(JSON.stringify(snapshot), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }
  } catch { /* the IndexedDB copy is the main one */ }
}

export async function deleteSnapshotBackup() {
  try {
    if (typeof caches !== 'undefined') await caches.delete(DATA_CACHE);
  } catch { /* ignore */ }
}
