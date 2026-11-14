// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '@/lib/config/defaults';
import {
  type AutoStartDeps,
  type DetectedLanguages,
  pageIsInLanguage,
  sampleText,
  startIfRemembered,
} from './auto-start';

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

describe('startIfRemembered', () => {
  const deps = (
    memory: unknown,
    declared = 'en',
  ): AutoStartDeps & { start: ReturnType<typeof vi.fn> } => ({
    origin: 'https://example.com',
    readMemory: async () => memory,
    getConfig: async () => createDefaultConfig('zh-CN'),
    declared,
    sample: () => 'text',
    detect: async () => detected('en'),
    start: vi.fn(async () => {}),
  });

  it('starts on a remembered foreign page only', async () => {
    const remembered = { 'https://example.com': { always: true } };
    const yes = deps(remembered);
    expect(await startIfRemembered(yes)).toBe(true);
    expect(yes.start).toHaveBeenCalledTimes(1);

    for (const other of [
      deps(undefined),
      deps({ 'https://other.com': { always: true } }),
      deps({ 'https://example.com': { always: false } }),
      deps(remembered, 'zh-CN'),
    ]) {
      expect(await startIfRemembered(other)).toBe(false);
      expect(other.start).not.toHaveBeenCalled();
    }
  });
});
