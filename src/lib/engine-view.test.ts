import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '@/lib/config/defaults';
import type { ConfigV1 } from '@/lib/config/types';
import {
  customShort,
  engineEntries,
  engineReadiness,
  hostName,
  hostOf,
  permissionPattern,
} from './engine-view';

function config(): ConfigV1 {
  const value = createDefaultConfig('zh-CN');
  value.customProviders = {
    'custom-bbbbbbbb': { name: 'Router', baseURL: 'https://router.example.com/v1', model: 'r' },
    'custom-aaaaaaaa': { name: '', baseURL: 'http://localhost:11434/v1', model: '' },
  };
  return value;
}

describe('engineEntries', () => {
  it('lists built-ins first, then custom providers in stored order, naming unnamed ones by host', () => {
    expect(engineEntries(config()).map((entry) => [entry.id, entry.name])).toEqual([
      ['google', 'Google 翻译'],
      ['openai', 'OpenAI'],
      ['deepseek', 'DeepSeek'],
      ['gemini', 'Gemini'],
      ['custom-bbbbbbbb', 'Router'],
      ['custom-aaaaaaaa', 'localhost:11434'],
    ]);
  });
});

describe('permissions', () => {
  it('needs no pattern for built-in or invalid URLs', () => {
    expect(permissionPattern('https://api.openai.com/v1')).toBeUndefined();
    expect(permissionPattern('http://example.com')).toBeUndefined();
    expect(permissionPattern('')).toBeUndefined();
    expect(permissionPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
  });
});

describe('engineReadiness', () => {
  const key = { configured: true, last4: '1234' };
  const none = { configured: false, last4: '' };
  const local = 'http://localhost:11434/v1';
  const base = { baseURL: '', model: 'm', secret: key, granted: undefined };

  it('Google is always ready', () => {
    expect(engineReadiness({ ...base, engine: 'google', model: '' })).toEqual({
      status: '免费',
      mono: false,
      attention: false,
    });
  });

  it('a built-in engine without a key is unconfigured, unless a key is being typed', () => {
    expect(engineReadiness({ ...base, engine: 'deepseek', secret: none })).toMatchObject({
      status: '未配置',
      reason: 'needs-key',
      problem: '还没有填写密钥',
    });
    expect(
      engineReadiness({ ...base, engine: 'deepseek', secret: none, keyDraft: true }).reason,
    ).toBeUndefined();
  });

  it('shows the key suffix once ready', () => {
    expect(engineReadiness({ ...base, engine: 'deepseek' })).toEqual({
      status: '密钥 ••••1234',
      mono: true,
      attention: false,
    });
  });

  it('OpenAI on its built-in origin needs no grant', () => {
    expect(
      engineReadiness({ ...base, engine: 'openai', baseURL: 'https://api.openai.com/v1' }).reason,
    ).toBeUndefined();
  });

  it('checks the address, then the grant, before the key and model', () => {
    const custom = { ...base, engine: 'custom-aaaaaaaa' as const, secret: none, model: '' };
    expect(engineReadiness({ ...custom, baseURL: 'ftp://x' })).toMatchObject({
      reason: 'bad-url',
      status: '地址有误',
    });
    expect(engineReadiness({ ...custom, baseURL: local, granted: false })).toMatchObject({
      reason: 'needs-grant',
      status: '待授权',
      attention: true,
    });
    const checking = engineReadiness({ ...custom, baseURL: local, granted: undefined });
    expect(checking).toMatchObject({ reason: 'checking-grant', attention: false });
    expect(checking.problem).toBeUndefined();
  });

  it('flags a missing model', () => {
    expect(engineReadiness({ ...base, engine: 'gemini', model: ' ' })).toMatchObject({
      attention: true,
      reason: 'needs-model',
      problem: '还没有填写模型',
    });
  });

  it('a custom provider without a key is still usable', () => {
    expect(
      engineReadiness({
        ...base,
        engine: 'custom-aaaaaaaa',
        baseURL: local,
        secret: undefined,
        granted: true,
      }),
    ).toEqual({ status: '未填密钥', mono: false, attention: false });
  });
});

describe('hostOf and hostName', () => {
  it('returns an empty host for an unparsable URL', () => {
    expect(hostOf('not a url')).toBe('');
  });

  it('cuts long hosts to the stored name limit', () => {
    const host = `${'a'.repeat(60)}.example.com`;
    expect(hostName(`https://${host}/v1`)).toHaveLength(40);
  });
});

describe('customShort', () => {
  it('takes the first two characters of the name', () => {
    expect(customShort('硅基流动')).toBe('硅基');
    expect(customShort('  My LLM ')).toBe('My');
  });

  it('never cuts an emoji in half', () => {
    expect(customShort('👩‍💻 Coder')).toBe('👩‍💻 ');
  });

  it('uses a generic label for an empty name', () => {
    expect(customShort('')).toBe('自');
    expect(customShort('   ')).toBe('自');
  });
});
