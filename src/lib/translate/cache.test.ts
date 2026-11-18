import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CacheOptions, createTranslationCache, openCacheDb } from './cache';

let dbName = 0;
const open = (name: string) => () => openCacheDb(name);
function setup(options: CacheOptions = {}) {
  const name = `test-${dbName++}`;
  return { name, cache: createTranslationCache({ open: open(name), ...options }) };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.useRealTimers());

describe('translation cache', () => {
  it('puts and gets entries, ignoring misses', async () => {
    const { cache } = setup();
    await cache.put([
      { key: 'a', text: 'A' },
      { key: 'b', text: 'B' },
    ]);
    const hits = await cache.getMany(['a', 'b', 'c']);
    expect(Object.fromEntries(hits)).toEqual({ a: 'A', b: 'B' });
  });

  it('drops expired entries on read and deletes the record', async () => {
    let time = 1_000;
    const { cache } = setup({ now: () => time, ttlMs: 100 });
    await cache.put([{ key: 'a', text: 'A' }]);
    time += 101;
    expect((await cache.getMany(['a'])).size).toBe(0);
    expect(await cache.stats()).toEqual({ count: 0, totalBytes: 0 });
  });

  it('evicts least recently used entries down to the low-water mark', async () => {
    let time = 1;
    const { cache } = setup({ now: () => time, maxBytes: 100, targetBytes: 50 });
    const text = 'x'.repeat(19); // 20 bytes with a one-character key
    for (const key of ['a', 'b', 'c', 'd']) {
      time += 1;
      await cache.put([{ key, text }]);
    }
    time += 1;
    await cache.touch(['a']); // a is now the most recently used
    time += 1;
    await cache.put([{ key: 'e', text }]); // 100 bytes: not over the limit yet
    time += 1;
    await cache.put([{ key: 'f', text }]); // 120 bytes: evict oldest until <= 50
    const hits = await cache.getMany(['a', 'b', 'c', 'd', 'e', 'f']);
    expect([...hits.keys()].sort()).toEqual(['e', 'f']);
    expect((await cache.stats()).totalBytes).toBe(40);
  });

  it('keeps totalBytes equal to the stored bytes after concurrent puts', async () => {
    const { cache } = setup();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        cache.put([
          { key: `k${i % 10}`, text: 'x'.repeat(10 + (i % 5)) },
          { key: `m${i}`, text: 'y'.repeat(7) },
        ]),
      ),
    );
    const stats = await cache.stats();
    const hits = await cache.getMany([
      ...Array.from({ length: 10 }, (_, i) => `k${i}`),
      ...Array.from({ length: 20 }, (_, i) => `m${i}`),
    ]);
    const actual = [...hits].reduce((sum, [key, text]) => sum + key.length + text.length, 0);
    expect(stats.count).toBe(30);
    expect(stats.totalBytes).toBe(actual);
  });

  it('skips entries above the per-entry limit', async () => {
    const { cache } = setup({ maxEntryBytes: 50 });
    await cache.put([
      { key: 'big', text: 'x'.repeat(100) },
      { key: 'ok', text: 'x' },
    ]);
    expect([...(await cache.getMany(['big', 'ok'])).keys()]).toEqual(['ok']);
  });

  it('degrades to no cache when opening fails, then recovers', async () => {
    const name = `test-${dbName++}`;
    let fail = true;
    const cache = createTranslationCache({
      open: () => (fail ? Promise.reject(new Error('blocked')) : openCacheDb(name)),
    });
    await cache.put([{ key: 'a', text: 'A' }]);
    expect((await cache.getMany(['a'])).size).toBe(0);
    await expect(cache.stats()).rejects.toMatchObject({ code: 'internal/cache-unavailable' });
    expect(console.warn).toHaveBeenCalled();
    fail = false;
    await cache.put([{ key: 'a', text: 'A' }]);
    expect((await cache.getMany(['a'])).get('a')).toBe('A');
  });

  it('treats a read that hangs for over 1s as a miss', async () => {
    vi.useFakeTimers();
    const cache = createTranslationCache({ open: () => new Promise(() => undefined) });
    const pending = cache.getMany(['a']);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).size).toBe(0);
  });

  it('clears everything and reports stats', async () => {
    const { cache } = setup();
    await cache.put([
      { key: 'a', text: 'AAA' },
      { key: 'b', text: 'BB' },
    ]);
    expect(await cache.stats()).toEqual({ count: 2, totalBytes: 1 + 3 + 1 + 2 });
    await cache.clear();
    expect(await cache.stats()).toEqual({ count: 0, totalBytes: 0 });
  });

  it('reads old data from a new instance (simulated SW restart)', async () => {
    const { name, cache } = setup();
    await cache.put([{ key: 'a', text: 'A' }]);
    const restarted = createTranslationCache({ open: open(name) });
    expect((await restarted.getMany(['a'])).get('a')).toBe('A');
  });
});

// ------------------------------------------------------------ hardening

/**
 * Wraps a real connection: counts opens / closes, can fail the next transaction
 * and reports every readwrite transaction it starts (with its `done` promise).
 */
function instrumented(name: string) {
  const state = {
    opened: 0,
    closed: 0,
    failNext: undefined as string | undefined,
    /** Which transactions failNext hits, and how many matching ones to let through first. */
    failMode: 'readwrite' as 'readwrite' | 'readonly',
    failSkip: 0,
    onReadwrite: undefined as ((done: Promise<void>) => void) | undefined,
  };
  const open = async () => {
    const db = await openCacheDb(name);
    state.opened += 1;
    return new Proxy(db, {
      get(target, prop) {
        if (prop === 'close') {
          return () => {
            state.closed += 1;
            target.close();
          };
        }
        if (prop === 'transaction') {
          return (...args: Parameters<typeof target.transaction>) => {
            const failure = state.failNext;
            const mode = args[1] ?? 'readonly';
            if (failure && args[2] === undefined && mode === state.failMode) {
              if (state.failSkip > 0) {
                state.failSkip -= 1;
              } else {
                state.failNext = undefined;
                throw new DOMException('injected', failure);
              }
            }
            const tx = target.transaction(...args);
            if (args[1] === 'readwrite') state.onReadwrite?.(tx.done);
            return tx;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  return { state, open };
}

describe('translation cache: hardening', () => {
  it('keeps serving reads while a large eviction runs in batches', async () => {
    const name = `test-${dbName++}`;
    const filler = createTranslationCache({ open: open(name), now: () => 1 });
    await filler.put(
      Array.from({ length: 6000 }, (_, i) => ({
        key: `k${String(i).padStart(4, '0')}`,
        text: 'x',
      })),
    );
    const { state, open: openDb } = instrumented(name);
    const cache = createTranslationCache({
      open: openDb,
      now: () => 2,
      maxBytes: 30_000,
      targetBytes: 600,
      // What this test checks is transaction order, asserted below. A short
      // wall-clock timeout made it flaky: one 500-record batch in
      // fake-indexeddb can take over 100ms when the whole suite runs in parallel.
      readTimeoutMs: 60_000,
    });
    await cache.getMany(['warm-up']);
    // Readwrite transactions in start order: the put, then one per eviction batch.
    const writes: { done: boolean }[] = [];
    let firstBatchStarted: () => void = () => undefined;
    const evictionStarted = new Promise<void>((resolve) => {
      firstBatchStarted = resolve;
    });
    state.onReadwrite = (done) => {
      const write = { done: false };
      writes.push(write);
      done.then(() => {
        write.done = true;
      });
      if (writes.length === 2) firstBatchStarted();
    };
    let putSettled = false;
    const evicting = cache.put([{ key: 'fresh', text: 'F' }]).finally(() => {
      putSettled = true;
    });
    await evictionStarted;
    const hits = await cache.getMany(['fresh']);
    expect(hits.get('fresh')).toBe('F');
    // Issued during the first batch, the read waits for that batch only: it is
    // served before any later batch finishes and while the eviction goes on.
    expect(writes.filter((write) => write.done)).toHaveLength(2);
    expect(putSettled).toBe(false);
    await evicting;
    // 6001 entries of 6 bytes down to 600 bytes, 500 per batch: 12 batches.
    expect(writes).toHaveLength(13);
    const stats = await cache.stats();
    expect(stats.totalBytes).toBeLessThanOrEqual(600);
    expect(stats.totalBytes).toBe(stats.count * 6); // every entry is 6 bytes
  });

  it('does not delete a record rewritten after an expired read', async () => {
    let time = 1_000;
    const { cache } = setup({ now: () => time, ttlMs: 100 });
    await cache.put([{ key: 'a', text: 'old' }]);
    time += 101;
    // The read sees the expired record; the put lands before the TTL delete runs.
    const read = cache.getMany(['a']);
    const write = cache.put([{ key: 'a', text: 'new' }]);
    expect((await read).size).toBe(0);
    await write;
    expect((await cache.getMany(['a'])).get('a')).toBe('new');
    expect(await cache.stats()).toEqual({ count: 1, totalBytes: 4 });
  });

  it('evicts and drops the write when the quota is exceeded', async () => {
    let time = 1;
    const { state, open: openDb } = instrumented(`test-${dbName++}`);
    const cache = createTranslationCache({ open: openDb, now: () => time });
    for (const key of ['a', 'b', 'c']) {
      time += 1;
      await cache.put([{ key, text: 'x'.repeat(9) }]);
    }
    state.failNext = 'QuotaExceededError';
    await cache.put([{ key: 'd', text: 'x'.repeat(9) }]);
    const hits = await cache.getMany(['a', 'b', 'c', 'd']);
    expect(hits.has('d')).toBe(false);
    expect(hits.has('a')).toBe(false); // least recently used went first
    const stats = await cache.stats();
    expect(stats.totalBytes).toBe(stats.count * 10);
    expect(console.warn).toHaveBeenCalledWith('[cache] put failed', 'QuotaExceededError');
    expect(state.opened).toBe(1);
  });

  it('closes the old connection before reopening after a failure', async () => {
    const { state, open: openDb } = instrumented(`test-${dbName++}`);
    const cache = createTranslationCache({ open: openDb });
    for (let i = 0; i < 5; i += 1) {
      state.failNext = 'InvalidStateError';
      await cache.put([{ key: `k${i}`, text: 'x' }]);
      await cache.put([{ key: `ok${i}`, text: 'x' }]);
    }
    expect(state.opened).toBe(6);
    expect(state.opened - state.closed).toBe(1);
    expect((await cache.getMany(['ok4'])).get('ok4')).toBe('x');
  });
});

// ------------------------------------------------------------ sweep and honest errors

const DAY = 24 * 60 * 60 * 1000;

/** Writes through a throwaway instance so the cache under test has not yet had its first put. */
async function seed(name: string, time: number, entries: { key: string; text: string }[]) {
  const seeder = createTranslationCache({ open: open(name), now: () => time, ttlMs: 100 * DAY });
  await seeder.put(entries);
  const db = await openCacheDb(name);
  await db.delete('meta', 'sweptAt'); // the seeding put swept once; start without a record of it
  db.close();
}

/** Writes records straight into the database (bytes = key + text), with no sweep record. */
async function writeRecords(
  name: string,
  records: { key: string; text: string; createdAt: number; lastUsedAt?: number }[],
) {
  const db = await openCacheDb(name);
  let total = 0;
  for (const record of records) {
    const bytes = record.key.length + record.text.length;
    total += bytes;
    await db.put('translations', {
      ...record,
      lastUsedAt: record.lastUsedAt ?? record.createdAt,
      bytes,
    });
  }
  await db.put('meta', total, 'totalBytes');
  db.close();
}

describe('translation cache: expired sweep', () => {
  it('deletes cold expired records and keeps fresh ones', async () => {
    const { name, cache } = setup({ now: () => 1_000, ttlMs: 100 });
    await writeRecords(name, [
      { key: 'cold', text: 'C', createdAt: 890 },
      { key: 'fresh', text: 'F', createdAt: 980 },
    ]);
    await cache.sweepExpired();
    expect(await cache.stats()).toEqual({ count: 1, totalBytes: 'fresh'.length + 1 });
    expect((await cache.getMany(['fresh'])).get('fresh')).toBe('F');
  });

  it('judges by createdAt: a record read once and never again still goes at 7 days', async () => {
    const { name, cache } = setup({ now: () => 1_000, ttlMs: 100 });
    // Created 101 ago, last used 41 ago.
    await writeRecords(name, [{ key: 'a', text: 'A', createdAt: 899, lastUsedAt: 959 }]);
    await cache.sweepExpired();
    expect(await cache.stats()).toEqual({ count: 0, totalBytes: 0 });
  });

  it('leaves meta.totalBytes equal to the remaining records after a sweep', async () => {
    const { name, cache } = setup({ now: () => 1_000, ttlMs: 100 });
    await writeRecords(name, [
      { key: 'a', text: 'AAAA', createdAt: 880 },
      { key: 'b', text: 'BB', createdAt: 940 },
      { key: 'c', text: 'CCC', createdAt: 1_000 },
    ]);
    await cache.sweepExpired();
    expect(await cache.stats()).toEqual({ count: 2, totalBytes: 1 + 2 + 1 + 3 });
  });

  it('finishes tables larger than one batch', async () => {
    const name = `test-${dbName++}`;
    await seed(
      name,
      1,
      Array.from({ length: 1300 }, (_, i) => ({
        key: `k${String(i).padStart(4, '0')}`,
        text: 'x',
      })),
    );
    const { state, open: openDb } = instrumented(name);
    const cache = createTranslationCache({
      open: openDb,
      now: () => 1 + 100 * DAY + 1,
      ttlMs: 100 * DAY,
      readTimeoutMs: 60_000,
    });
    let writes = 0;
    state.onReadwrite = () => {
      writes += 1;
    };
    await cache.sweepExpired();
    expect(await cache.stats()).toEqual({ count: 0, totalBytes: 0 });
    expect(writes).toBe(3); // 500 + 500 + 300
  });

  it('does not sweep again within 24 hours', async () => {
    let time = 1_000;
    const { name, cache } = setup({ now: () => time, ttlMs: 100 });
    await writeRecords(name, [{ key: 'old', text: 'O', createdAt: 0 }]);
    await cache.sweepExpired(); // old is swept, sweptAt = 1000
    await writeRecords(name, [{ key: 'cold', text: 'C', createdAt: 0 }]);
    time += 150; // cold is expired, but the last sweep was 150 ms ago
    await cache.sweepExpired();
    expect((await cache.stats()).count).toBe(1);
    time += DAY;
    await cache.sweepExpired();
    expect((await cache.stats()).count).toBe(0);
  });

  it('treats a sweptAt in the future as due', async () => {
    const { name, cache } = setup({ now: () => 10 * DAY, ttlMs: 100 });
    await writeRecords(name, [{ key: 'cold', text: 'C', createdAt: 0 }]);
    const db = await openCacheDb(name);
    await db.put('meta', 10 * DAY + 5 * DAY, 'sweptAt'); // the clock went back
    db.close();
    await cache.sweepExpired();
    expect(await cache.stats()).toEqual({ count: 0, totalBytes: 0 });
  });

  it('does not write sweptAt when the sweep fails midway', async () => {
    const name = `test-${dbName++}`;
    await seed(
      name,
      1,
      Array.from({ length: 700 }, (_, i) => ({ key: `k${String(i).padStart(4, '0')}`, text: 'x' })),
    );
    const { state, open: openDb } = instrumented(name);
    const time = 1 + 100 * DAY + 1;
    const cache = createTranslationCache({
      open: openDb,
      now: () => time,
      ttlMs: 100 * DAY,
      readTimeoutMs: 60_000,
    });
    state.failNext = 'InvalidStateError';
    state.failSkip = 1; // first batch goes through, second fails
    await cache.sweepExpired();
    expect(state.failNext).toBeUndefined();
    const db = await openCacheDb(name);
    expect(await db.get('meta', 'sweptAt')).toBeUndefined();
    expect(await db.count('translations')).toBe(200);
    db.close();
    await cache.sweepExpired(); // retried, not throttled
    expect((await cache.stats()).count).toBe(0);
  });

  it('first sweeps after the first put of the lifetime; reads never trigger it', async () => {
    const name = `test-${dbName++}`;
    await seed(name, 1, [{ key: 'cold', text: 'C' }]);
    const time = 1 + 100 * DAY + 1;
    const cache = createTranslationCache({ open: open(name), now: () => time, ttlMs: 100 * DAY });
    await cache.getMany(['other']);
    await cache.touch(['cold']);
    const check = await openCacheDb(name);
    expect(await check.count('translations')).toBe(1);
    await cache.put([{ key: 'fresh', text: 'F' }]);
    expect(await check.count('translations')).toBe(1); // cold swept, fresh added
    expect(await check.get('translations', 'cold')).toBeUndefined();
    expect(await check.get('meta', 'sweptAt')).toBe(time);
    check.close();
  });
});

describe('translation cache: clear and stats report failures', () => {
  for (const method of ['clear', 'stats'] as const) {
    it(`${method} throws when opening fails, then recovers`, async () => {
      const name = `test-${dbName++}`;
      let fail = true;
      const cache = createTranslationCache({
        open: () => (fail ? Promise.reject(new Error('blocked')) : openCacheDb(name)),
      });
      await expect(cache[method]()).rejects.toMatchObject({
        kind: 'internal',
        code: 'internal/cache-unavailable',
      });
      fail = false;
      await expect(cache[method]()).resolves.not.toThrow();
    });

    it(`${method} throws when the transaction fails, drops the connection and recovers`, async () => {
      const { state, open: openDb } = instrumented(`test-${dbName++}`);
      const cache = createTranslationCache({ open: openDb });
      await cache.put([{ key: 'a', text: 'A' }]);
      state.failMode = method === 'clear' ? 'readwrite' : 'readonly';
      state.failNext = 'InvalidStateError';
      await expect(cache[method]()).rejects.toMatchObject({ code: 'internal/cache-unavailable' });
      await cache[method]();
      expect(state.opened - state.closed).toBe(1);
      expect(await cache.stats()).toEqual(
        method === 'clear' ? { count: 0, totalBytes: 0 } : { count: 1, totalBytes: 2 },
      );
    });
  }
});
