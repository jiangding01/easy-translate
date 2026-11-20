// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { DetectedLanguages } from '@/lib/languages';
import { pageIsInLanguage, sampleText } from './page-language';

const detected = (language: string, percentage = 90): DetectedLanguages => ({
  isReliable: true,
  languages: [{ language, percentage }],
});

describe('pageIsInLanguage', () => {
  it('trusts a declared <html lang> and skips detection', async () => {
    const detect = vi.fn();
    expect(
      await pageIsInLanguage('zh-CN', { declared: 'zh-Hans', sample: () => 'x', detect }),
    ).toBe(true);
    expect(await pageIsInLanguage('zh-CN', { declared: 'zh-TW', sample: () => 'x', detect })).toBe(
      false,
    );
    expect(await pageIsInLanguage('zh-CN', { declared: 'en-US', sample: () => 'x', detect })).toBe(
      false,
    );
    expect(detect).not.toHaveBeenCalled();
  });

  it('detects the language when the page declares none', async () => {
    const deps = { declared: '', sample: () => 'some text' };
    expect(await pageIsInLanguage('zh-CN', { ...deps, detect: async () => detected('zh') })).toBe(
      true,
    );
    expect(await pageIsInLanguage('zh-CN', { ...deps, detect: async () => detected('en') })).toBe(
      false,
    );
    expect(
      await pageIsInLanguage('zh-CN', { ...deps, detect: async () => detected('zh', 30) }),
    ).toBe(false);
  });

  it('translates when detection fails, and leaves an empty page alone', async () => {
    const failing = async () => {
      throw new Error('unavailable');
    };
    expect(
      await pageIsInLanguage('zh-CN', { declared: '', sample: () => 'text', detect: failing }),
    ).toBe(false);
    expect(
      await pageIsInLanguage('zh-CN', { declared: '', sample: () => '  ', detect: failing }),
    ).toBe(true);
  });
});

describe('sampleText', () => {
  it('collects readable text without scripts and stops at the limit', () => {
    document.body.innerHTML =
      '<h1>Title  here</h1><script>var secret = 1;</script><p>Body <b>text</b></p>';
    expect(sampleText(document.body)).toBe('Title here Body text ');
    expect(sampleText(document.body, 5)).toBe('Title');
  });
});
