import { describe, expect, it } from 'vitest';
import { classifyText, MAX_UNIT_CHARS } from './text';

describe('classifyText', () => {
  it('tells prose, noise and oversized text apart', () => {
    expect(classifyText('Hello world', 11)).toBe('ok');
    expect(classifyText('https://example.com/a', 21)).toBe('noise');
    expect(classifyText('word '.repeat(1100), 5500)).toBe('long');
  });

  it('needs at least two letters', () => {
    expect(classifyText('ab', 2)).toBe('ok');
    expect(classifyText('a 1 2', 5)).toBe('noise');
    expect(classifyText('a', 1)).toBe('noise');
    expect(classifyText('', 0)).toBe('noise');
    expect(classifyText('   ', 3)).toBe('noise');
  });

  it('judges noise by the plain text and length by the sent text', () => {
    // Short sent text with a long plain text: the length is the sent one.
    expect(classifyText('word '.repeat(2000), 40)).toBe('ok');
    // Long sent text with a short plain text.
    expect(classifyText('Short plain text', MAX_UNIT_CHARS + 1)).toBe('long');
  });

  it('checks noise before length, so a huge URL or table is not "too long"', () => {
    expect(classifyText(`https://example.com/${'a'.repeat(6000)}`, 6020)).toBe('noise');
    expect(classifyText('1 '.repeat(3000), 6000)).toBe('noise');
  });

  it('is long only above the limit', () => {
    expect(classifyText('word', MAX_UNIT_CHARS)).toBe('ok');
    expect(classifyText('word', MAX_UNIT_CHARS + 1)).toBe('long');
  });

  it('skips text that is only a date', () => {
    for (const date of [
      'Nov 09, 2026',
      'Sep 28, 2026',
      '28 September 2026',
      'Sept. 3',
      '2026-11-14',
    ]) {
      expect(classifyText(date, date.length)).toBe('noise');
    }
    for (const prose of [
      'May the best tool win',
      'March',
      'Published on Nov 9, 2026 by Addy',
      'Maybe 2',
      'Mark 2',
      'Octopus 8',
    ]) {
      expect(classifyText(prose, prose.length)).toBe('ok');
    }
  });
});
