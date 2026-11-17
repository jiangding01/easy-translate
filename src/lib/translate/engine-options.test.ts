import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '@/lib/config/defaults';
import { BUILTIN_ENGINES, type ConfigV1 } from '@/lib/config/types';
import { NOT_READY_TEXT } from '@/lib/engine-view';
import { PROVIDER_ICONS } from '@/lib/provider-icons';
import { buildEngineOptions, UNNAMED_CUSTOM_NAME } from './engine-options';

const keyed = { configured: true, last4: 'wxyz' };

function configWith(customProviders: ConfigV1['customProviders'] = {}): ConfigV1 {
  const config = createDefaultConfig('zh-CN');
  config.providers.deepseek.model = 'deepseek-chat';
  config.providers.gemini.model = 'gemini-model';
  config.providers.openai.model = 'gpt-model';
  config.customProviders = customProviders;
  return config;
}

const granted = () => Promise.resolve(true);

describe('buildEngineOptions', () => {
  it('lists the built-in engines first with fixed short labels', async () => {
    const result = await buildEngineOptions({
      config: configWith(),
      secrets: { openai: keyed, deepseek: keyed, gemini: keyed },
      hasPermission: granted,
    });
    expect(result.configured).toBe('google');
    expect(result.options.map((option) => option.id)).toEqual([...BUILTIN_ENGINES]);
    expect(result.options.map((option) => option.short)).toEqual(['G', 'AI', 'DS', 'Ge']);
    expect(result.options.map((option) => option.name)).toEqual([
      'Google 翻译',
      'OpenAI',
      'DeepSeek',
      'Gemini',
    ]);
    expect(result.options.every((option) => option.ready && option.note === undefined)).toBe(true);
  });

  it('marks keyless built-ins not ready with the settings wording', async () => {
    const result = await buildEngineOptions({
      config: configWith(),
      secrets: { openai: keyed },
      hasPermission: granted,
    });
    const byId = Object.fromEntries(result.options.map((option) => [option.id, option]));
    expect(byId.google?.ready).toBe(true);
    expect(byId.openai?.ready).toBe(true);
    expect(byId.deepseek).toMatchObject({ ready: false, note: NOT_READY_TEXT['needs-key'] });
    expect(byId.gemini).toMatchObject({ ready: false, note: NOT_READY_TEXT['needs-key'] });
  });

  it('reports a missing model', async () => {
    const config = configWith();
    config.providers.gemini.model = '  ';
    const result = await buildEngineOptions({
      config,
      secrets: { gemini: keyed },
      hasPermission: granted,
    });
    expect(result.options.find((option) => option.id === 'gemini')).toMatchObject({
      ready: false,
      note: NOT_READY_TEXT['needs-model'],
    });
  });

  it('checks host permissions only for endpoints that need one', async () => {
    const hasPermission = vi.fn((pattern: string) =>
      Promise.resolve(pattern.includes('granted.example.com')),
    );
    const result = await buildEngineOptions({
      config: configWith({
        'custom-aaaaaaaa': {
          name: 'Granted',
          baseURL: 'https://granted.example.com/v1',
          model: 'm',
        },
        'custom-bbbbbbbb': {
          name: 'Pending',
          baseURL: 'https://pending.example.com/v1',
          model: 'm',
        },
        'custom-cccccccc': { name: 'Broken', baseURL: 'not a url', model: 'm' },
      }),
      secrets: { openai: keyed },
      hasPermission,
    });
    // The default OpenAI endpoint needs no optional permission.
    expect(hasPermission).toHaveBeenCalledTimes(2);
    const byId = Object.fromEntries(result.options.map((option) => [option.id, option]));
    expect(byId['custom-aaaaaaaa']?.ready).toBe(true);
    expect(byId['custom-bbbbbbbb']).toMatchObject({
      ready: false,
      note: NOT_READY_TEXT['needs-grant'],
    });
    expect(byId['custom-cccccccc']).toMatchObject({
      ready: false,
      note: NOT_READY_TEXT['bad-url'],
    });
  });

  it('treats a failing permission query as not granted', async () => {
    const result = await buildEngineOptions({
      config: configWith({
        'custom-aaaaaaaa': { name: 'Remote', baseURL: 'https://remote.example.com/v1', model: 'm' },
      }),
      secrets: {},
      hasPermission: () => Promise.reject(new Error('gone')),
    });
    expect(result.options.at(-1)).toMatchObject({ ready: false });
  });

  it('names custom providers by their first two graphemes, and unnamed ones generically', async () => {
    const result = await buildEngineOptions({
      config: configWith({
        'custom-aaaaaaaa': { name: '本地模型', baseURL: 'http://localhost:11434/v1', model: 'm' },
        'custom-bbbbbbbb': { name: 'Ollama', baseURL: 'http://localhost:11434/v1', model: 'm' },
        'custom-cccccccc': { name: '', baseURL: 'http://secret-host.example:11434/v1', model: 'm' },
        'custom-dddddddd': { name: '  ', baseURL: 'http://localhost:11434/v1', model: 'm' },
        'custom-eeeeeeee': { name: '👨‍👩‍👧x', baseURL: 'http://localhost:11434/v1', model: 'm' },
      }),
      secrets: {},
      hasPermission: granted,
    });
    const custom = result.options.slice(BUILTIN_ENGINES.length);
    expect(custom.map((option) => [option.name, option.short])).toEqual([
      ['本地模型', '本地'],
      ['Ollama', 'Ol'],
      [UNNAMED_CUSTOM_NAME, '自'],
      [UNNAMED_CUSTOM_NAME, '自'],
      ['👨‍👩‍👧x', '👨‍👩‍👧x'],
    ]);
  });

  it('keeps custom providers in stored order and reports the configured engine', async () => {
    const config = configWith({
      'custom-bbbbbbbb': { name: 'B', baseURL: 'http://localhost:1/v1', model: 'm' },
      'custom-aaaaaaaa': { name: 'A', baseURL: 'http://localhost:1/v1', model: 'm' },
    });
    config.translation.engine = 'custom-aaaaaaaa';
    const result = await buildEngineOptions({ config, secrets: {}, hasPermission: granted });
    expect(result.configured).toBe('custom-aaaaaaaa');
    expect(result.options.slice(-2).map((option) => option.id)).toEqual([
      'custom-bbbbbbbb',
      'custom-aaaaaaaa',
    ]);
  });

  it('carries vendor icons for the built-ins and the preset addresses only', async () => {
    const result = await buildEngineOptions({
      config: configWith({
        'custom-aaaaaaaa': { name: 'Ollama', baseURL: 'http://localhost:11434/v1', model: 'm' },
        'custom-bbbbbbbb': { name: 'LM', baseURL: 'http://127.0.0.1:1234/v1', model: 'm' },
        'custom-cccccccc': { name: 'OR', baseURL: 'https://openrouter.ai/api/v1', model: 'm' },
        'custom-dddddddd': { name: '硅基', baseURL: 'https://api.siliconflow.cn/v1', model: 'm' },
        'custom-eeeeeeee': { name: '其他', baseURL: 'https://llm.example.com/v1', model: 'm' },
        'custom-ffffffff': { name: '', baseURL: '', model: 'm' },
      }),
      secrets: {},
      hasPermission: granted,
    });
    expect(result.options.map((option) => option.icon)).toEqual([
      PROVIDER_ICONS.google,
      PROVIDER_ICONS.openai,
      PROVIDER_ICONS.deepseek,
      PROVIDER_ICONS.gemini,
      PROVIDER_ICONS.ollama,
      PROVIDER_ICONS.lmstudio,
      PROVIDER_ICONS.openrouter,
      PROVIDER_ICONS.siliconflow,
      undefined,
      undefined,
    ]);
    expect(result.options.slice(-2).every((option) => !('icon' in option))).toBe(true);
  });

  it('returns only whitelisted fields, never key material, URLs, hosts or models', async () => {
    const result = await buildEngineOptions({
      config: configWith({
        'custom-aaaaaaaa': {
          name: '',
          baseURL: 'https://private-host.example.com/v1',
          model: 'private-model-name',
        },
      }),
      secrets: {
        openai: { configured: true, last4: 'q9z7' },
        'custom-aaaaaaaa': { configured: true, last4: 'k3k3' },
      },
      hasPermission: granted,
    });
    for (const option of result.options) {
      expect(
        Object.keys(option).every((key) =>
          ['id', 'name', 'short', 'ready', 'note', 'icon'].includes(key),
        ),
      ).toBe(true);
    }
    expect(Object.keys(result).sort()).toEqual(['configured', 'options']);
    const text = JSON.stringify(result);
    for (const leaked of [
      'status',
      'last4',
      'q9z7',
      'k3k3',
      'baseURL',
      'private-host',
      'example.com',
      'private-model-name',
      'gpt-model',
      'deepseek-chat',
      'api.openai.com',
    ]) {
      expect(text).not.toContain(leaked);
    }
  });
});
