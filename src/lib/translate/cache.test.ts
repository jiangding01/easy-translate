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
    expect(await cache.stats()).toEqual({ count: 0, totalBytes: 0 });
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

/** Wraps a real connection: counts opens / closes and can fail the next transaction. */
function instrumented(name: string) {
  const state = { opened: 0, closed: 0, failNext: undefined as string | undefined };
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
            if (failure && args[2] === undefined && args[1] === 'readwrite') {
              state.failNext = undefined;
              throw new DOMException('injected', failure);
            }
            return target.transaction(...args);
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
    const cache = createTranslationCache({
      open: open(name),
      now: () => 2,
      maxBytes: 30_000,
      targetBytes: 600,
      readTimeoutMs: 100,
    });
    await cache.getMany(['warm-up']);
    const evicting = cache.put([{ key: 'fresh', text: 'F' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const hits = await cache.getMany(['fresh']);
    expect(hits.get('fresh')).toBe('F');
    await evicting;
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
