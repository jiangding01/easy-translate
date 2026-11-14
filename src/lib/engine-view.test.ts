import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '@/lib/config/defaults';
import type { ConfigV1 } from '@/lib/config/types';
import {
  defaultProviderName,
  engineEntries,
  engineReadiness,
  hostOf,
  newCustomId,
  PRESETS,
  patternsInUse,
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

describe('newCustomId', () => {
  it('makes a valid id and skips taken ones', () => {
    const fixed = (value: number) => (bytes: Uint8Array) => bytes.fill(value);
    expect(newCustomId([], fixed(0))).toBe('custom-aaaaaaaa');
    let calls = 0;
    const random = (bytes: Uint8Array) => bytes.fill(calls++ === 0 ? 0 : 1);
    expect(newCustomId(['custom-aaaaaaaa'], random)).toBe('custom-bbbbbbbb');
    expect(newCustomId([])).toMatch(/^custom-[a-z0-9]{8}$/);
  });
});

describe('names and hosts', () => {
  it('keeps the preset label only while its address is untouched', () => {
    const ollama = PRESETS.find((preset) => preset.id === 'ollama');
    expect(defaultProviderName(ollama, 'http://localhost:11434/v1/')).toBe('Ollama（本地）');
    expect(defaultProviderName(ollama, 'http://localhost:9999/v1')).toBe('localhost:9999');
    expect(hostOf('not a url')).toBe('');
  });
});

describe('permissions', () => {
  it('needs no pattern for built-in or invalid URLs', () => {
    expect(permissionPattern('https://api.openai.com/v1')).toBeUndefined();
    expect(permissionPattern('http://example.com')).toBeUndefined();
    expect(permissionPattern('')).toBeUndefined();
    expect(permissionPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
  });

  it('collects patterns still in use, excluding one provider', () => {
    const value = config();
    expect(patternsInUse(value)).toEqual(
      new Set(['https://router.example.com/*', 'http://localhost/*']),
    );
    expect(patternsInUse(value, 'custom-aaaaaaaa')).toEqual(
      new Set(['https://router.example.com/*']),
    );
  });
});

describe('engineReadiness', () => {
  const key = { configured: true, last4: '1234' };
  const none = { configured: false, last4: '' };

  it('Google is always ready', () => {
    expect(
      engineReadiness({ engine: 'google', model: '', secret: undefined, granted: undefined }),
    ).toEqual({
      status: '免费',
      mono: false,
      attention: false,
    });
  });

  it('a built-in engine without a key is unconfigured', () => {
    expect(
      engineReadiness({ engine: 'openai', model: 'm', secret: none, granted: undefined }),
    ).toMatchObject({
      status: '未配置',
      problem: '还没有填写密钥',
    });
  });

  it('shows the key suffix once ready', () => {
    expect(
      engineReadiness({ engine: 'deepseek', model: 'm', secret: key, granted: undefined }),
    ).toEqual({
      status: '密钥 ••••1234',
      mono: true,
      attention: false,
    });
  });

  it('flags a missing grant before anything else', () => {
    expect(
      engineReadiness({ engine: 'custom-aaaaaaaa', model: '', secret: none, granted: false }),
    ).toMatchObject({ status: '待授权', attention: true });
  });

  it('flags a missing model', () => {
    expect(
      engineReadiness({ engine: 'gemini', model: ' ', secret: key, granted: undefined }),
    ).toMatchObject({
      attention: true,
      problem: '还没有填写模型',
    });
  });

  it('a custom provider without a key is still usable', () => {
    expect(
      engineReadiness({ engine: 'custom-aaaaaaaa', model: 'm', secret: undefined, granted: true }),
    ).toEqual({ status: '未填密钥', mono: false, attention: false });
  });
});
