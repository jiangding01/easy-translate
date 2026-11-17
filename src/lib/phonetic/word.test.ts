import { describe, expect, it } from 'vitest';
import { phoneticKey } from './word';

describe('phoneticKey', () => {
  it.each([
    ['Hello', 'hello'],
    ['  WORLD. ', 'world'],
    ['"quoted"', 'quoted'],
    ["John's", 'john'],
    ['John’s', 'john'],
    ["o'clock", "o'clock"],
    ['O’Clock', "o'clock"],
    ["dogs'", 'dogs'],
    ['a'.repeat(40), 'a'.repeat(40)],
  ])('%s → %s', (text, key) => {
    expect(phoneticKey(text)).toBe(key);
  });

  it.each([
    'hello world',
    'well-known',
    'café',
    'mp3',
    'x2',
    "rock'n'roll",
    '你好',
    '',
    '...',
    'a'.repeat(41),
  ])('%s is not a word', (text) => {
    expect(phoneticKey(text)).toBeUndefined();
  });
});
