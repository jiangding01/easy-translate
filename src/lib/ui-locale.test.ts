import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createGetMessage, loadLocales } from '../../scripts/i18n-messages.mjs';
import { applyUiLocale, uiLocale } from './ui-locale';

const original = fakeBrowser.i18n.getMessage;

afterEach(() => {
  fakeBrowser.i18n.getMessage = original;
});

describe('uiLocale', () => {
  it('is the locale of the copy Chrome picked, not the browser language', async () => {
    expect(uiLocale()).toBe('zh-CN');
    // A zh-HK or de browser gets the en copy (no such locale file): en, whatever the browser.
    const getMessage = createGetMessage(await loadLocales(), 'zh_HK');
    fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage;
    expect(uiLocale()).toBe('en');
  });

  it('sets <html lang> on extension pages', () => {
    const doc = { documentElement: { lang: 'fr' } } as Document;
    applyUiLocale(doc);
    expect(doc.documentElement.lang).toBe('zh-CN');
  });
});

describe('uiLocale fallback', () => {
  it('is en when the message is empty', () => {
    fakeBrowser.i18n.getMessage = (() => '') as typeof fakeBrowser.i18n.getMessage;
    expect(uiLocale()).toBe('en');
  });
});
