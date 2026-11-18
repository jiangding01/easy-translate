import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { describeError } from '@/lib/error-messages';
import { appError } from '@/lib/errors';
import { createGetMessage, loadLocales } from '../../scripts/i18n-messages.mjs';
import { errorText } from './error-text';

describe('errorText', () => {
  it('prefers the userMessage the background attached', () => {
    const error = {
      ...appError('provider', 'provider/unauthorized', '401'),
      userMessage: '后台文案',
    };
    expect(errorText(error)).toBe('后台文案');
  });

  it('falls back to the local table for errors the content side makes itself', () => {
    for (const code of ['network/page-unreachable', 'validation/bad-response'] as const) {
      const error = appError(code.startsWith('network') ? 'network' : 'validation', code, 'x');
      // Same copy as the full table, which the settings page and popup keep using.
      expect(errorText(error)).toBe(describeError(error));
    }
  });

  it('uses the generic sentence for an unknown code without userMessage', () => {
    expect(errorText(appError('network', 'network/port-disconnected', 'x'))).toBe(
      '操作失败，请重试。',
    );
    // A code the full table knows, arriving without userMessage, is not looked up here.
    expect(errorText(appError('provider', 'provider/unauthorized', '401'))).toBe(
      '操作失败，请重试。',
    );
  });

  it('prefers userMessage over the local table', () => {
    const error = {
      ...appError('validation', 'validation/bad-response', 'x'),
      userMessage: '后台文案',
    };
    expect(errorText(error)).toBe('后台文案');
  });
});

/** Switches the getMessage stub to the en copy (vitest.setup puts zh_CN back before each test). */
async function useEnglish() {
  const getMessage = createGetMessage(await loadLocales(), 'en');
  fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage;
}

describe('errorText in English', () => {
  it('looks up its local errors and fallback in the current UI language', async () => {
    await useEnglish();
    expect(errorText(appError('validation', 'validation/bad-response', 'x'))).toBe(
      describeError(appError('validation', 'validation/bad-response', 'x')),
    );
    expect(errorText(appError('internal', 'internal/whatever', 'x'))).toBe(
      'Something went wrong. Try again.',
    );
  });
});
