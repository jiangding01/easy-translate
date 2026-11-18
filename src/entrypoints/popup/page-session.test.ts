import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { i18n } from '#i18n';
import { appError } from '@/lib/errors';
import { createGetMessage, loadLocales } from '../../../scripts/i18n-messages.mjs';
import { failedText, pausedReason } from './page-session';

/** Switches the getMessage stub to the en copy (vitest.setup puts zh_CN back before each test). */
async function useEnglish() {
  const getMessage = createGetMessage(await loadLocales(), 'en');
  fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage;
}

describe('pausedReason', () => {
  it('gives a short reason per engine-level error', () => {
    expect(pausedReason(appError('provider', 'provider/unauthorized', 'x'))).toBe('密钥无效');
    expect(pausedReason(appError('provider', 'provider/quota-exceeded', 'x'))).toBe('额度已用完');
    expect(pausedReason(appError('provider', 'provider/local-origin-rejected', 'x'))).toBe(
      '本地服务拒绝了请求',
    );
    expect(pausedReason(appError('config', 'config/permission-missing', 'x'))).toBe(
      '还没有授权访问接口',
    );
    expect(pausedReason(appError('config', 'config/model-required', 'x'))).toBe('设置不完整');
  });

  it('follows the UI language', async () => {
    await useEnglish();
    expect(pausedReason(appError('provider', 'provider/unauthorized', 'x'))).toBe(
      'invalid API key',
    );
    expect(pausedReason(appError('config', 'config/model-required', 'x'))).toBe('setup incomplete');
  });
});

describe('panel copy', () => {
  it('counts failed paragraphs with the plural and number format of the UI language', async () => {
    expect(failedText(3)).toBe('3 段没有译出');
    await useEnglish();
    expect(failedText(1)).toBe('1 paragraph not translated');
    expect(failedText(3)).toBe('3 paragraphs not translated');
    expect(failedText(1234)).toBe('1,234 paragraphs not translated');
  });

  it('keeps the engine name and its reason apart', async () => {
    expect(i18n.t('popup.engineNotReady', ['DeepSeek', '还没有填写密钥'])).toBe(
      'DeepSeek 还没有填写密钥',
    );
    await useEnglish();
    expect(i18n.t('popup.engineNotReady', ['DeepSeek', 'No API key yet'])).toBe(
      'DeepSeek: No API key yet',
    );
    expect(i18n.t('popup.pausedNotice', ['DeepSeek', 'invalid API key'])).toBe(
      'DeepSeek: invalid API key. Translation paused.',
    );
  });
});
