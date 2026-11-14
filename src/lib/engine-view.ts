import {
  type BuiltinEngine,
  type ConfigV1,
  type CustomProvider,
  type CustomProviderId,
  type Engine,
  isBuiltinEngine,
} from '@/lib/config/types';
import { normalizeBaseURL, requiredHostPermission } from '@/lib/endpoint';
import type { SecretStatusInfo } from '@/lib/messaging/protocol';

// Engine view logic shared by the settings page and the toolbar panel: no React, no browser APIs.

export interface BuiltinMeta {
  name: string;
  /** Where to get a key (and, for Gemini, the model list). */
  link?: { href: string; label: string };
}

export const BUILTIN_META: Record<BuiltinEngine, BuiltinMeta> = {
  google: { name: 'Google 翻译' },
  openai: {
    name: 'OpenAI',
    link: { href: 'https://platform.openai.com/api-keys', label: '获取 API Key ↗' },
  },
  deepseek: {
    name: 'DeepSeek',
    link: { href: 'https://platform.deepseek.com/api_keys', label: '获取 API Key ↗' },
  },
  gemini: {
    name: 'Gemini',
    link: { href: 'https://ai.google.dev/gemini-api/docs/models', label: '密钥与模型列表 ↗' },
  },
};

export const BUILTIN_ORDER: readonly BuiltinEngine[] = ['google', 'openai', 'deepseek', 'gemini'];

export interface Preset {
  id: string;
  label: string;
  baseURL: string;
  /** Local servers usually take no key. */
  local: boolean;
}

/** Base URLs checked against each vendor's docs (2026-11-14). */
export const PRESETS: readonly Preset[] = [
  { id: 'ollama', label: 'Ollama（本地）', baseURL: 'http://localhost:11434/v1', local: true },
  { id: 'lmstudio', label: 'LM Studio（本地）', baseURL: 'http://localhost:1234/v1', local: true },
  { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', local: false },
  { id: 'siliconflow', label: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', local: false },
  { id: 'other', label: '其他', baseURL: '', local: false },
];

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `custom-` + 8 random lowercase letters or digits, unique among `existing`. */
export function newCustomId(
  existing: Iterable<string>,
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): CustomProviderId {
  const taken = new Set(existing);
  for (;;) {
    const bytes = random(new Uint8Array(8));
    const suffix = [...bytes].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
    const id: CustomProviderId = `custom-${suffix}`;
    if (!taken.has(id)) return id;
  }
}

/** `host[:port]` of a URL, or '' when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(normalizeBaseURL(url)).host;
  } catch {
    return '';
  }
}

/** A preset keeps its label while its address is untouched; otherwise the host names it. */
export function defaultProviderName(preset: Preset | undefined, baseURL: string): string {
  if (preset && preset.id !== 'other' && normalizeBaseURL(baseURL) === preset.baseURL) {
    return preset.label;
  }
  return hostOf(baseURL);
}

export interface EngineEntry {
  id: Engine;
  name: string;
  /** Present for custom providers. */
  custom?: CustomProvider;
}

/** Built-in engines first, then custom providers in stored order. */
export function engineEntries(config: ConfigV1): EngineEntry[] {
  return [
    ...BUILTIN_ORDER.map((id) => ({ id, name: BUILTIN_META[id].name })),
    ...Object.entries(config.customProviders).map(([id, custom]) => ({
      id: id as CustomProviderId,
      name: custom.name || hostOf(custom.baseURL) || '未命名服务',
      custom,
    })),
  ];
}

export function engineName(config: ConfigV1, engine: Engine): string {
  return engineEntries(config).find((entry) => entry.id === engine)?.name ?? engine;
}

/** The base URL an engine actually calls, or '' when it has a fixed built-in endpoint. */
export function editableBaseURL(config: ConfigV1, engine: Engine): string {
  if (engine === 'openai') return config.providers.openai.baseURL;
  if (isBuiltinEngine(engine)) return '';
  return config.customProviders[engine]?.baseURL ?? '';
}

export function modelOf(config: ConfigV1, engine: Engine): string {
  switch (engine) {
    case 'google':
      return '';
    case 'openai':
      return config.providers.openai.model;
    case 'deepseek':
      return config.providers.deepseek.model;
    case 'gemini':
      return config.providers.gemini.model;
    default:
      return config.customProviders[engine]?.model ?? '';
  }
}

/** Optional host permission pattern this base URL needs, or undefined (built-in or invalid). */
export function permissionPattern(baseURL: string): string | undefined {
  if (baseURL.trim() === '') return undefined;
  const required = requiredHostPermission(baseURL);
  return required.ok && required.data ? required.data.pattern : undefined;
}

/** Patterns still used by any provider other than `except`. */
export function patternsInUse(config: ConfigV1, except?: Engine): Set<string> {
  const patterns = new Set<string>();
  const add = (url: string) => {
    const pattern = permissionPattern(url);
    if (pattern) patterns.add(pattern);
  };
  if (except !== 'openai') add(config.providers.openai.baseURL);
  for (const [id, custom] of Object.entries(config.customProviders)) {
    if (id !== except) add(custom.baseURL);
  }
  return patterns;
}

export interface EngineReadiness {
  /** Short status on the right of the row. */
  status: string;
  /** Monospace status (key suffix). */
  mono: boolean;
  /** Something must be done before this engine can translate. */
  attention: boolean;
  /** One-line reason when attention is true. */
  problem?: string;
}

export function engineReadiness(input: {
  engine: Engine;
  model: string;
  secret: SecretStatusInfo | undefined;
  /** undefined: no grant needed (built-in origin) or not known yet. */
  granted: boolean | undefined;
}): EngineReadiness {
  const { engine, model, secret, granted } = input;
  if (engine === 'google') return { status: '免费', mono: false, attention: false };
  const keyed = secret?.configured === true;
  const keyStatus = keyed ? (secret.last4 ? `密钥 ••••${secret.last4}` : '已配置密钥') : '';
  if (granted === false) {
    return { status: '待授权', mono: false, attention: true, problem: '还没有授权访问这个地址' };
  }
  if (isBuiltinEngine(engine) && !keyed) {
    return { status: '未配置', mono: false, attention: false, problem: '还没有填写密钥' };
  }
  if (model.trim() === '') {
    return {
      status: keyStatus || '未填模型',
      mono: keyed && secret.last4 !== '',
      attention: true,
      problem: '还没有填写模型',
    };
  }
  if (!keyed) return { status: '未填密钥', mono: false, attention: false };
  return { status: keyStatus, mono: secret.last4 !== '', attention: false };
}
