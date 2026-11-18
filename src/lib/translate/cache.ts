import { type DBSchema, type IDBPDatabase, type IDBPTransaction, openDB } from 'idb';
import { appError } from '@/lib/errors';

const DB_NAME = 'islet-translate';
const DB_VERSION = 1;
const META_TOTAL = 'totalBytes';
const META_SWEPT = 'sweptAt';
/** Expired records are swept at most this often. */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const CACHE_DEFAULTS = {
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxBytes: 100 * 1024 * 1024,
  targetBytes: 80 * 1024 * 1024,
  maxEntryBytes: 256 * 1024,
  readTimeoutMs: 1000,
  /** Records deleted per eviction transaction; reads can run between batches. */
  evictBatchSize: 500,
  /** Records scanned per sweep transaction. */
  sweepBatchSize: 500,
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
  /** Deletes records older than the TTL, by createdAt, in small batches. */
  sweepExpired(): Promise<void>;
}

export interface CacheOptions {
  open?: () => Promise<Db>;
  now?: () => number;
  ttlMs?: number;
  maxBytes?: number;
  targetBytes?: number;
  maxEntryBytes?: number;
  readTimeoutMs?: number;
  evictBatchSize?: number;
  sweepBatchSize?: number;
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

function errorName(error: unknown): string {
  return error instanceof Error || error instanceof DOMException ? error.name : 'unknown';
}

/** Lets other transactions (reads above all) start between eviction batches. */
function yieldToOthers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * IndexedDB translation cache. Every mutation updates `translations` and the
 * `meta` byte total inside one readwrite transaction; overlapping readwrite
 * transactions run in order, so concurrent writers cannot skew the total.
 * Eviction runs after the write, in small transactions with a yield between
 * them, so reads are never stuck behind it. Failures degrade to "no cache":
 * the connection is closed and reopened on the next call.
 */
export function createTranslationCache(options: CacheOptions = {}): TranslationCache {
  const open = options.open ?? (() => openCacheDb());
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? CACHE_DEFAULTS.ttlMs;
  const maxBytes = options.maxBytes ?? CACHE_DEFAULTS.maxBytes;
  const targetBytes = options.targetBytes ?? CACHE_DEFAULTS.targetBytes;
  const maxEntryBytes = options.maxEntryBytes ?? CACHE_DEFAULTS.maxEntryBytes;
  const readTimeoutMs = options.readTimeoutMs ?? CACHE_DEFAULTS.readTimeoutMs;
  const evictBatchSize = options.evictBatchSize ?? CACHE_DEFAULTS.evictBatchSize;
  const sweepBatchSize = options.sweepBatchSize ?? CACHE_DEFAULTS.sweepBatchSize;

  let dbPromise: Promise<Db> | undefined;
  let evicting: Promise<void> | undefined;
  let evictAgain = false;
  let sweepChecked = false;

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

  /** Runs a store operation; on failure drops the connection (it reopens next call) and rethrows. */
  async function run<T>(task: (db: Db) => Promise<T>): Promise<T> {
    try {
      return await task(await getDb());
    } catch (error) {
      // Close the connection being dropped, so failures do not pile up open ones.
      const stale = dbPromise;
      dbPromise = undefined;
      stale?.then(
        (db) => db.close(),
        () => undefined,
      );
      throw error;
    }
  }

  /** Like `run`, but a failure only logs the error name and returns the fallback. */
  async function guarded<T>(task: (db: Db) => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run(task);
    } catch (error) {
      console.warn('[cache] unavailable', errorName(error));
      return fallback;
    }
  }

  /** For operations the user asked for: a failure is reported, not hidden. */
  async function reported<T>(task: (db: Db) => Promise<T>): Promise<T> {
    try {
      return await run(task);
    } catch (error) {
      console.warn('[cache] unavailable', errorName(error));
      throw appError('internal', 'internal/cache-unavailable', 'Cache unavailable');
    }
  }

  /** Deletes the records that are still expired; a record rewritten meanwhile is kept. */
  async function removeExpired(db: Db, keys: readonly string[], cutoff: number): Promise<void> {
    const tx = db.transaction(['translations', 'meta'], 'readwrite');
    const store = tx.objectStore('translations');
    let freed = 0;
    for (const key of keys) {
      const record = await store.get(key);
      if (!record || record.createdAt >= cutoff) continue;
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
    if (expired.length > 0) await removeExpired(db, expired, cutoff);
    return hits;
  }

  /**
   * One eviction transaction: deletes up to `evictBatchSize` least recently used
   * records while above the low-water mark (`force`: regardless of it), and
   * updates the byte total in the same transaction. Returns whether to go on.
   */
  async function evictBatch(db: Db, force: boolean): Promise<boolean> {
    const tx = db.transaction(['translations', 'meta'], 'readwrite');
    const meta = tx.objectStore('meta');
    let total = (await meta.get(META_TOTAL)) ?? 0;
    let removed = 0;
    if (force || total > targetBytes) {
      let cursor = await tx.objectStore('translations').index('lastUsedAt').openCursor();
      while (cursor && removed < evictBatchSize && (force || total > targetBytes)) {
        total -= cursor.value.bytes;
        removed += 1;
        await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    if (removed > 0) await meta.put(Math.max(0, total), META_TOTAL);
    await tx.done;
    return removed === evictBatchSize && total > targetBytes;
  }

  /** Evicts batch by batch down to the low-water mark; concurrent calls share one run. */
  function evict(force = false): Promise<void> {
    if (evicting) {
      evictAgain = true;
      return evicting;
    }
    const run = (async () => {
      let first = force;
      do {
        evictAgain = false;
        for (;;) {
          const more = await guarded((db) => evictBatch(db, first), false);
          first = false;
          if (!more) break;
          await yieldToOthers();
        }
      } while (evictAgain);
    })().finally(() => {
      evicting = undefined;
    });
    evicting = run;
    return run;
  }

  /**
   * One sweep transaction: scans up to `sweepBatchSize` records after `after`
   * (primary-key order), deletes the expired ones and updates the byte total in
   * the same transaction. The last batch also records `sweptAt`, so an
   * interrupted sweep is simply retried.
   */
  async function sweepBatch(
    db: Db,
    cutoff: number,
    stamp: number,
    after: string | undefined,
  ): Promise<{ last: string | undefined; done: boolean }> {
    const tx = db.transaction(['translations', 'meta'], 'readwrite');
    const meta = tx.objectStore('meta');
    let cursor = await tx
      .objectStore('translations')
      .openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true));
    let scanned = 0;
    let freed = 0;
    let last = after;
    while (cursor && scanned < sweepBatchSize) {
      scanned += 1;
      last = cursor.key;
      if (cursor.value.createdAt < cutoff) {
        freed += cursor.value.bytes;
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    const done = scanned < sweepBatchSize;
    if (freed > 0) {
      const total = (await meta.get(META_TOTAL)) ?? 0;
      await meta.put(Math.max(0, total - freed), META_TOTAL);
    }
    if (done) await meta.put(stamp, META_SWEPT);
    await tx.done;
    return { last, done };
  }

  /** Sweeps the whole table batch by batch; throws on failure. */
  async function sweepAll(db: Db): Promise<void> {
    const stamp = now();
    const cutoff = stamp - ttlMs;
    let after: string | undefined;
    for (;;) {
      const { last, done } = await sweepBatch(db, cutoff, stamp, after);
      if (done) return;
      after = last;
      await yieldToOthers();
    }
  }

  /** Sweeps unless the last completed sweep is under a day old (a future stamp counts as due). */
  function sweepIfDue(): Promise<void> {
    return guarded(async (db) => {
      const swept = await db.get('meta', META_SWEPT);
      const time = now();
      if (swept !== undefined && swept <= time && time - swept < SWEEP_INTERVAL_MS) return;
      await sweepAll(db);
    }, undefined);
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
        let total = 0;
        let tx: IDBPTransaction<CacheDB, ('translations' | 'meta')[], 'readwrite'> | undefined;
        try {
          tx = db.transaction(['translations', 'meta'], 'readwrite');
          const store = tx.objectStore('translations');
          const meta = tx.objectStore('meta');
          total = (await meta.get(META_TOTAL)) ?? 0;
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
          await meta.put(Math.max(0, total), META_TOTAL);
          await tx.done;
        } catch (error) {
          const quota = [error, tx?.error].some(
            (cause) => errorName(cause) === 'QuotaExceededError',
          );
          if (!quota) throw error;
          tx?.done.catch(() => undefined);
          // Storage is full: make room once and give up on this write.
          console.warn('[cache] put failed', 'QuotaExceededError');
          await evict(true);
          return;
        }
        // Evict least recently used down to the low-water mark, outside the write.
        if (total > maxBytes) await evict();
        // Once per service worker lifetime, check whether expired records are due for a sweep.
        if (!sweepChecked) {
          sweepChecked = true;
          await sweepIfDue();
        }
      }, undefined);
    },

    stats() {
      return reported(async (db) => {
        const tx = db.transaction(['translations', 'meta'], 'readonly');
        const [count, totalBytes] = await Promise.all([
          tx.objectStore('translations').count(),
          tx.objectStore('meta').get(META_TOTAL),
        ]);
        await tx.done;
        return { count, totalBytes: totalBytes ?? 0 };
      });
    },

    sweepExpired: sweepIfDue,

    clear() {
      return reported(async (db) => {
        const tx = db.transaction(['translations', 'meta'], 'readwrite');
        await Promise.all([tx.objectStore('translations').clear(), tx.objectStore('meta').clear()]);
        await tx.done;
      });
    },
  };
}
