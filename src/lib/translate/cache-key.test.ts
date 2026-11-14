import { describe, expect, it } from 'vitest';
import { type CacheKeyParts, makeCacheKey, stableStringify } from './cache-key';

const base: CacheKeyParts = {
  engine: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: 'm',
  source: 'auto',
  target: 'zh-CN',
  promptDigest: 'abc',
  paramsDigest: '',
  text: 'hello',
};

describe('cache key', () => {
  it('serializes independently of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(
      stableStringify({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }),
    );
  });

  it('is versioned, stable and independent of property order', async () => {
    const key = await makeCacheKey(base);
    expect(key).toMatch(/^v1:[0-9a-f]{64}$/);
    const shuffled = Object.fromEntries(Object.entries(base).reverse()) as CacheKeyParts;
    expect(await makeCacheKey(shuffled)).toBe(key);
  });

  it.each(Object.keys(base) as (keyof CacheKeyParts)[])(
    'changes when %s changes',
    async (field) => {
      expect(await makeCacheKey({ ...base, [field]: `${base[field]}x` })).not.toBe(
        await makeCacheKey(base),
      );
    },
  );
});
