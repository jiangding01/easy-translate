import type { BuiltinEngine, CustomProviderId } from '@/lib/config/types';
import { normalizeBaseURL } from '@/lib/endpoint';
import { hostName, type NotReady } from '@/lib/engine-view';

// Settings-page-only data: kept out of the shared engine view so the toolbar
// panel does not carry it.

/** Where to get a key (and, for Gemini, the model list). */
export const KEY_LINKS: Partial<Record<BuiltinEngine, { href: string; label: string }>> = {
  openai: { href: 'https://platform.openai.com/api-keys', label: '获取 API Key ↗' },
  deepseek: { href: 'https://platform.deepseek.com/api_keys', label: '获取 API Key ↗' },
  gemini: { href: 'https://ai.google.dev/gemini-api/docs/models', label: '密钥与模型列表 ↗' },
};

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

/** A preset keeps its label while its address is untouched; otherwise the host names it. */
export function defaultProviderName(preset: Preset | undefined, baseURL: string): string {
  if (preset && preset.id !== 'other' && normalizeBaseURL(baseURL) === preset.baseURL) {
    return preset.label;
  }
  return hostName(baseURL);
}

/** Why the connection test is disabled. */
export const TEST_BLOCKED_TEXT: Record<NotReady, string> = {
  'bad-url': '先填写正确的地址',
  'checking-grant': '正在检查授权…',
  'needs-grant': '授权后可以测试',
  'needs-key': '填写 API Key 后可以测试',
  'needs-model': '填写模型后可以测试',
};
