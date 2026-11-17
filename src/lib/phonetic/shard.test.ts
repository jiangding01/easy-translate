import { describe, expect, it } from 'vitest';
import { shardFor, shardKey } from './shard';
import { SHARDS } from './shards.generated';

describe('shardKey', () => {
  it.each([
    ['hello', 2, 'he'],
    ['a', 2, 'a_'],
    ['i', 2, 'i_'],
    ["o'clock", 2, 'o_'],
    ["y'all", 2, 'y_'],
    ['contrast', 3, 'con'],
    ['co', 3, 'co_'],
    ['c', 3, 'c__'],
  ])('%s at depth %i → %s', (word, depth, key) => {
    expect(shardKey(word, depth)).toBe(key);
  });
});

describe('shardFor', () => {
  // "co" split by three letters, "he" not.
  const listed = new Set(['he', 'co_', 'coa', 'con', 'a_']);

  it.each([
    ['hello', 'he'],
    ['a', 'a_'],
    ['contrast', 'con'],
    ['coat', 'coa'],
    ['co', 'co_'],
    ['cow', undefined],
    ['zebra', undefined],
  ])('%s → %s', (word, shard) => {
    expect(shardFor(word, listed)).toBe(shard);
  });
});

describe('the generated shard list', () => {
  it('lists the shards of both accents, sorted, without duplicates', () => {
    for (const list of [SHARDS.uk, SHARDS.us]) {
      const keys = list.split(' ');
      expect(keys.length).toBeGreaterThan(100);
      expect(new Set(keys).size).toBe(keys.length);
      expect([...keys].sort()).toEqual(keys);
      for (const key of keys) expect(key).toMatch(/^[a-z_]{2,3}$/);
    }
    expect(SHARDS.uk.split(' ')).toContain('he');
  });
});
