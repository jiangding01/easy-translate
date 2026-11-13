import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

const DB_NAME = 'easy-translate';
const DB_VERSION = 1;
const META_TOTAL = 'totalBytes';

export const CACHE_DEFAULTS = {
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxBytes: 100 * 1024 * 1024,
  targetBytes: 80 * 1024 * 1024,
  maxEntryBytes: 256 * 1024,
  readTimeoutMs: 1000,
};

interface CacheRecord {
  key: string;
  text: string;
  createdAt: number;
  lastUsedAt: number;
  bytes: number;
}

interface CacheDB extends DBSchema {
  translations: { key: string; value: CacheRecord; indexes: { lastUsedAt: number } };
  meta: { key: string; value: number };
}

type Db = IDBPDatabase<CacheDB>;

export interface CacheStats {
  count: number;
  totalBytes: number;
}

export interface TranslationCache {
  /** Hits only; a slow or failing store counts as a miss. */
  getMany(keys: readonly string[]): Promise<Map<string, string>>;
  /** Refreshes lastUsedAt; call once per request for the hits. */
  touch(keys: readonly string[]): Promise<void>;
  put(entries: readonly { key: string; text: string }[]): Promise<void>;
  stats(): Promise<CacheStats>;
  clear(): Promise<void>;
}

export interface CacheOptions {
  open?: () => Promise<Db>;
  now?: () => number;
  ttlMs?: number;
  maxBytes?: number;
  targetBytes?: number;
  maxEntryBytes?: number;
  readTimeoutMs?: number;
}

export function openCacheDb(name = DB_NAME): Promise<Db> {
  return openDB<CacheDB>(name, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore('translations', { keyPath: 'key' });
      store.createIndex('lastUsedAt', 'lastUsedAt');
      db.createObjectStore('meta');
    },
  });
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * IndexedDB translation cache. Every mutation updates `translations` and the
 * `meta` byte total inside one readwrite transaction; overlapping readwrite
 * transactions run in order, so concurrent writers cannot skew the total.
 * Failures degrade to "no cache" and the database is reopened on the next call.
 */
export function createTranslationCache(options: CacheOptions = {}): TranslationCache {
  const open = options.open ?? (() => openCacheDb());
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? CACHE_DEFAULTS.ttlMs;
  const maxBytes = options.maxBytes ?? CACHE_DEFAULTS.maxBytes;
  const targetBytes = options.targetBytes ?? CACHE_DEFAULTS.targetBytes;
  const maxEntryBytes = options.maxEntryBytes ?? CACHE_DEFAULTS.maxEntryBytes;
  const readTimeoutMs = options.readTimeoutMs ?? CACHE_DEFAULTS.readTimeoutMs;

  let dbPromise: Promise<Db> | undefined;

  function getDb(): Promise<Db> {
    if (!dbPromise) {
      const attempt = open().then((db) => {
        // Another tab or a version upgrade wants the database: let go and reopen later.
        db.addEventListener('versionchange', () => {
          db.close();
          if (dbPromise === attempt) dbPromise = undefined;
        });
        return db;
      });
      dbPromise = attempt;
      attempt.catch(() => {
        if (dbPromise === attempt) dbPromise = undefined;
      });
    }
    return dbPromise;
  }

  /** Runs a store operation; on failure logs the error name only and returns the fallback. */
  async function guarded<T>(task: (db: Db) => Promise<T>, fallback: T): Promise<T> {
    try {
      return await task(await getDb());
    } catch (error) {
      console.warn('[cache] unavailable', error instanceof Error ? error.name : 'unknown');
      dbPromise = undefined;
      return fallback;
    }
  }

  async function removeKeys(db: Db, keys: readonly string[]): Promise<void> {
    const tx = db.transaction(['translations', 'meta'], 'readwrite');
    const store = tx.objectStore('translations');
    let freed = 0;
    for (const key of keys) {
      const record = await store.get(key);
      if (!record) continue;
      freed += record.bytes;
      await store.delete(key);
    }
    if (freed > 0) {
      const total = (await tx.objectStore('meta').get(META_TOTAL)) ?? 0;
      await tx.objectStore('meta').put(Math.max(0, total - freed), META_TOTAL);
    }
    await tx.done;
  }

  async function read(db: Db, keys: readonly string[]): Promise<Map<string, string>> {
    const hits = new Map<string, string>();
    const expired: string[] = [];
    const tx = db.transaction('translations', 'readonly');
    const cutoff = now() - ttlMs;
    for (const key of keys) {
      const record = await tx.store.get(key);
      if (!record) continue;
      if (record.createdAt < cutoff) expired.push(key);
      else hits.set(key, record.text);
    }
    await tx.done;
    if (expired.length > 0) await removeKeys(db, expired);
    return hits;
  }

  return {
    async getMany(keys) {
      if (keys.length === 0) return new Map();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<Map<string, string>>((resolve) => {
        timer = setTimeout(() => resolve(new Map()), readTimeoutMs);
      });
      try {
        return await Promise.race([
          guarded((db) => read(db, keys), new Map<string, string>()),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
    },

    touch(keys) {
      if (keys.length === 0) return Promise.resolve();
      return guarded(async (db) => {
        const tx = db.transaction('translations', 'readwrite');
        const stamp = now();
        for (const key of keys) {
          const record = await tx.store.get(key);
          if (record) await tx.store.put({ ...record, lastUsedAt: stamp });
        }
        await tx.done;
      }, undefined);
    },

    put(entries) {
      const accepted = entries
        .map((entry) => ({ ...entry, bytes: byteLength(entry.text) + entry.key.length }))
        .filter((entry) => entry.bytes <= maxEntryBytes);
      if (accepted.length === 0) return Promise.resolve();
      return guarded(async (db) => {
        const tx = db.transaction(['translations', 'meta'], 'readwrite');
        const store = tx.objectStore('translations');
        const meta = tx.objectStore('meta');
        let total = (await meta.get(META_TOTAL)) ?? 0;
        const stamp = now();
        for (const entry of accepted) {
          const previous = await store.get(entry.key);
          total += entry.bytes - (previous?.bytes ?? 0);
          await store.put({
            key: entry.key,
            text: entry.text,
            createdAt: stamp,
            lastUsedAt: stamp,
            bytes: entry.bytes,
          });
        }
        if (total > maxBytes) {
          // Evict least recently used until under the low-water mark.
          let cursor = await store.index('lastUsedAt').openCursor();
          while (cursor && total > targetBytes) {
            total -= cursor.value.bytes;
            await cursor.delete();
            cursor = await cursor.continue();
          }
        }
        await meta.put(Math.max(0, total), META_TOTAL);
        await tx.done;
      }, undefined);
    },

    stats() {
      return guarded(
        async (db) => {
          const tx = db.transaction(['translations', 'meta'], 'readonly');
          const [count, totalBytes] = await Promise.all([
            tx.objectStore('translations').count(),
            tx.objectStore('meta').get(META_TOTAL),
          ]);
          await tx.done;
          return { count, totalBytes: totalBytes ?? 0 };
        },
        { count: 0, totalBytes: 0 },
      );
    },

    clear() {
      return guarded(async (db) => {
        const tx = db.transaction(['translations', 'meta'], 'readwrite');
        await Promise.all([tx.objectStore('translations').clear(), tx.objectStore('meta').clear()]);
        await tx.done;
      }, undefined);
    },
  };
}
