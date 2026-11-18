import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { i18n } from '#i18n';
import { createGetMessage, loadLocales } from '../../../scripts/i18n-messages.mjs';
import { cacheSummary } from './CacheSection';
import { SPLIT_MARK, splitAround } from './EngineItem';

/** Switches the getMessage stub to the en copy (vitest.setup puts zh_CN back before each test). */
async function useEnglish() {
  const getMessage = createGetMessage(await loadLocales(), 'en');
  fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage;
}

describe('cacheSummary', () => {
  it('says there is no cache yet when the count is 0', async () => {
    expect(cacheSummary({ count: 0, totalBytes: 0 })).toBe('暂无缓存 · 译文保留 7 天');
    await useEnglish();
    expect(cacheSummary({ count: 0, totalBytes: 0 })).toBe(
      'No cache yet · translations are kept 7 days',
    );
  });

  it('keeps the zh copy unchanged', () => {
    expect(cacheSummary({ count: 1, totalBytes: 512 })).toBe('1 段译文 · 512 B · 保留 7 天');
    expect(cacheSummary({ count: 1234, totalBytes: 2048 })).toBe(
      '1,234 段译文 · 2.0 KB · 保留 7 天',
    );
  });

  it('picks the plural form and formats the number for the en copy', async () => {
    await useEnglish();
    expect(cacheSummary({ count: 1, totalBytes: 512 })).toBe(
      '1 cached translation · 512 B · kept 7 days',
    );
    expect(cacheSummary({ count: 1234, totalBytes: 3 * 1024 * 1024 })).toBe(
      '1,234 cached translations · 3.0 MB · kept 7 days',
    );
  });

  it('formats the count for the locale of the copy, not a fixed one', async () => {
    // en and zh-CN both group as "1,234": report a locale that groups differently.
    const getMessage = createGetMessage(await loadLocales(), 'en');
    fakeBrowser.i18n.getMessage = ((name: string, substitutions?: string | string[]) =>
      name === 'meta_locale'
        ? 'de'
        : getMessage(name, substitutions)) as typeof fakeBrowser.i18n.getMessage;
    expect(cacheSummary({ count: 1234, totalBytes: 2048 })).toBe(
      '1.234 cached translations · 2.0 KB · kept 7 days',
    );
  });
});

describe('splitAround', () => {
  it('splits the sentence around the node that goes mid-sentence', async () => {
    const key = 'options.engine.grantNeeded';
    expect(splitAround(i18n.t(key, [SPLIT_MARK]))).toEqual(['需要允许扩展访问 ', '']);
    await useEnglish();
    expect(splitAround(i18n.t(key, [SPLIT_MARK]))).toEqual(['The extension needs access to ', '']);
  });

  it('keeps text on both sides and survives a missing marker', () => {
    expect(splitAround(`a${SPLIT_MARK}b`)).toEqual(['a', 'b']);
    expect(splitAround('plain')).toEqual(['plain', '']);
  });
});
