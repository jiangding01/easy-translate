import { describe, expect, it } from 'vitest';
import { describeError } from '@/lib/error-messages';
import { appError } from '@/lib/errors';
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
