import { describe, expect, it } from 'vitest';
import { appError, fail, ok } from '@/lib/errors';
import { panelState } from './panel-state';

const page = (language: string) => ({ host: 'example.com', info: ok({ title: 't', language }) });

describe('panelState', () => {
  it('is loading until the page has answered', () => {
    expect(panelState(undefined, 'zh-CN')).toEqual({ kind: 'loading' });
  });

  it('recognizes a page already in the target language', () => {
    expect(panelState(page('zh-Hans-CN'), 'zh-CN')).toEqual({
      kind: 'native',
      host: 'example.com',
      language: 'zh-CN',
    });
  });

  it('treats other and undeclared languages as foreign', () => {
    expect(panelState(page('en-US'), 'zh-CN')).toEqual({
      kind: 'foreign',
      host: 'example.com',
      language: 'en',
    });
    expect(panelState(page(''), 'zh-CN')).toEqual({
      kind: 'foreign',
      host: 'example.com',
      language: undefined,
    });
    expect(panelState(page('zh-TW'), 'zh-CN')).toMatchObject({
      kind: 'foreign',
      language: 'zh-TW',
    });
  });

  it('separates pages that need a reload from pages that can never be translated', () => {
    const unreachable = fail(appError('network', 'network/page-unreachable', 'x'));
    expect(panelState({ host: 'a.com', info: unreachable }, 'en')).toEqual({
      kind: 'unreachable',
      host: 'a.com',
    });
    const blocked = fail(appError('validation', 'validation/unsupported-page', 'x'));
    expect(panelState({ host: 'extensions', info: blocked }, 'en')).toEqual({ kind: 'blocked' });
  });
});
