import { describe, expect, it } from 'vitest';
import { defaultTargetLanguage, normalizeLanguage } from './languages';

describe('normalizeLanguage', () => {
  it.each([
    ['zh_cn', 'zh-CN'],
    ['ZH-cn', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh_HK', 'zh-TW'],
    ['en-US', 'en'],
    ['ja-JP', 'ja'],
    ['ko', 'ko'],
  ])('maps %s to %s', (tag, code) => {
    expect(normalizeLanguage(tag)).toBe(code);
  });

  it.each(['xx', 'fr-FR', ''])('returns undefined for unsupported tag %j', (tag) => {
    expect(normalizeLanguage(tag)).toBeUndefined();
  });
});

describe('defaultTargetLanguage', () => {
  it('uses the UI language when supported', () => {
    expect(defaultTargetLanguage('ja-JP')).toBe('ja');
  });

  it('falls back to en', () => {
    expect(defaultTargetLanguage('fr-FR')).toBe('en');
    expect(defaultTargetLanguage('')).toBe('en');
  });
});
