import { describe, expect, it } from 'vitest';
import { MAX_RETRY_AFTER_MS, parseRetryAfter } from './errors';

describe('parseRetryAfter', () => {
  it('reads delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });

  it('caps oversized values at 60s', () => {
    expect(MAX_RETRY_AFTER_MS).toBe(60_000);
    expect(parseRetryAfter('86400')).toBe(60_000);
    expect(parseRetryAfter('9999999999999')).toBe(60_000);
    expect(parseRetryAfter(new Date(10 ** 12).toUTCString(), 0)).toBe(60_000);
  });
});
