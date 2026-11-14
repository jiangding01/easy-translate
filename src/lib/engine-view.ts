import { hasEditableBaseURL, takesApiKey } from '@/lib/config/engine-fields';
import {
  BUILTIN_ENGINES,
  type BuiltinEngine,
  type ConfigV1,
  CUSTOM_PROVIDER_LIMITS,
  type CustomProvider,
  type CustomProviderId,
  type Engine,
  isBuiltinEngine,
} from '@/lib/config/types';
import { normalizeBaseURL, requiredHostPermission } from '@/lib/endpoint';
import type { SecretStatusInfo } from '@/lib/messaging/protocol';

// Engine view logic shared by the settings page and the toolbar panel: no React, no browser APIs.

/** `host[:port]` of a URL, or '' when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(normalizeBaseURL(url)).host;
  } catch {
    return '';
  }
}

/** Host-based fallback name, cut to the stored name limit. */
export function hostName(baseURL: string): string {
  return hostOf(baseURL).slice(0, CUSTOM_PROVIDER_LIMITS.name);
}

/** Display names of the built-in engines. */
export const BUILTIN_NAMES: Record<BuiltinEngine, string> = {
  google: 'Google 翻译',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
};

export interface EngineEntry {
  id: Engine;
  name: string;
  /** Present for custom providers. */
  custom?: CustomProvider;
}

/** Built-in engines first, then custom providers in stored order. */
export function engineEntries(config: ConfigV1): EngineEntry[] {
  return [
    ...BUILTIN_ENGINES.map((id) => ({ id, name: BUILTIN_NAMES[id] })),
    ...Object.entries(config.customProviders).map(([id, custom]) => ({
      id: id as CustomProviderId,
      name: custom.name || hostOf(custom.baseURL) || '未命名服务',
      custom,
    })),
  ];
}

/** Optional host permission pattern this base URL needs, or undefined (built-in or invalid). */
export function permissionPattern(baseURL: string): string | undefined {
  if (baseURL.trim() === '') return undefined;
  const required = requiredHostPermission(baseURL);
  return required.ok && required.data ? required.data.pattern : undefined;
}

/** Why an engine cannot translate (or be tested) yet, in the order the user should fix it. */
export type NotReady = 'bad-url' | 'checking-grant' | 'needs-grant' | 'needs-key' | 'needs-model';

/** Row and panel wording; `checking-grant` is transient and never shown as a problem. */
export const NOT_READY_TEXT: Record<Exclude<NotReady, 'checking-grant'>, string> = {
  'bad-url': '地址格式不正确',
  'needs-grant': '还没有授权访问这个地址',
  'needs-key': '还没有填写密钥',
  'needs-model': '还没有填写模型',
};

export interface EngineReadiness {
  /** Short status on the right of the row. */
  status: string;
  /** Monospace status (key suffix). */
  mono: boolean;
  /** Something must be done before this engine can translate. */
  attention: boolean;
  reason?: NotReady;
  /** One-line problem for real (non-transient) reasons. */
  problem?: string;
}

export interface ReadinessInput {
  engine: Engine;
  baseURL: string;
  model: string;
  secret: SecretStatusInfo | undefined;
  /** Whether the endpoint's host permission is granted; undefined while unknown or not needed. */
  granted: boolean | undefined;
  /** A key typed but not saved yet (settings page). */
  keyDraft?: boolean;
}

/** The single readiness rule for rows, the panel and the connection test. */
export function engineReadiness(input: ReadinessInput): EngineReadiness {
  const { engine, baseURL, model, secret, granted } = input;
  if (engine === 'google') return { status: '免费', mono: false, attention: false };
  const keyed = secret?.configured === true;
  const keyStatus = keyed ? (secret.last4 ? `密钥 ••••${secret.last4}` : '已配置密钥') : '';
  const mono = keyed && secret.last4 !== '';
  const notReady = (reason: NotReady, status: string, attention: boolean): EngineReadiness => ({
    status,
    mono: status === keyStatus && mono,
    attention,
    reason,
    problem: reason === 'checking-grant' ? undefined : NOT_READY_TEXT[reason],
  });

  if (hasEditableBaseURL(engine)) {
    if (!requiredHostPermission(baseURL).ok) return notReady('bad-url', '地址有误', true);
    if (permissionPattern(baseURL)) {
      if (granted === false) return notReady('needs-grant', '待授权', true);
      if (granted === undefined) {
        return notReady('checking-grant', keyStatus || '未填密钥', false);
      }
    }
  }
  if (isBuiltinEngine(engine) && takesApiKey(engine) && !keyed && !input.keyDraft) {
    return notReady('needs-key', '未配置', false);
  }
  if (model.trim() === '') return notReady('needs-model', keyStatus || '未填模型', true);
  if (!keyed)
    return {
      status: isBuiltinEngine(engine) ? '未保存' : '未填密钥',
      mono: false,
      attention: false,
    };
  return { status: keyStatus, mono, attention: false };
}
