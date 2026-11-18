import { i18n } from '#i18n';
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

// Engine view logic shared by the settings page, the toolbar panel and the background: no
// React. UI copy comes from src/locales and is looked up per call, never at module top level.

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

/** Display name of a built-in engine; brand names stay untranslated (i18n.md 4.5). */
export function builtinName(engine: BuiltinEngine): string {
  switch (engine) {
    case 'google':
      return i18n.t('engine.googleName');
    case 'openai':
      return 'OpenAI';
    case 'deepseek':
      return 'DeepSeek';
    case 'gemini':
      return 'Gemini';
  }
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
    ...BUILTIN_ENGINES.map((id) => ({ id, name: builtinName(id) })),
    ...Object.entries(config.customProviders).map(([id, custom]) => ({
      id: id as CustomProviderId,
      name: custom.name || hostOf(custom.baseURL) || i18n.t('engine.unnamed'),
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

const NOT_READY_KEYS = {
  'bad-url': 'engine.notReady.badUrl',
  'needs-grant': 'engine.notReady.needsGrant',
  'needs-key': 'engine.notReady.needsKey',
  'needs-model': 'engine.notReady.needsModel',
} as const satisfies Record<Exclude<NotReady, 'checking-grant'>, string>;

/** Row and panel wording; `checking-grant` is transient and never shown as a problem. */
export function notReadyText(reason: Exclude<NotReady, 'checking-grant'>): string {
  return i18n.t(NOT_READY_KEYS[reason]);
}

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
  if (engine === 'google')
    return { status: i18n.t('engine.status.free'), mono: false, attention: false };
  const keyed = secret?.configured === true;
  const keyStatus = keyed
    ? secret.last4
      ? i18n.t('engine.status.keySuffix', [secret.last4])
      : i18n.t('engine.status.keyConfigured')
    : '';
  const mono = keyed && secret.last4 !== '';
  const notReady = (reason: NotReady, status: string, attention: boolean): EngineReadiness => ({
    status,
    mono: status === keyStatus && mono,
    attention,
    reason,
    problem: reason === 'checking-grant' ? undefined : notReadyText(reason),
  });

  if (hasEditableBaseURL(engine)) {
    if (!requiredHostPermission(baseURL).ok)
      return notReady('bad-url', i18n.t('engine.status.badUrl'), true);
    if (permissionPattern(baseURL)) {
      if (granted === false)
        return notReady('needs-grant', i18n.t('engine.status.needsGrant'), true);
      if (granted === undefined) {
        return notReady('checking-grant', keyStatus || i18n.t('engine.status.noKey'), false);
      }
    }
  }
  if (isBuiltinEngine(engine) && takesApiKey(engine) && !keyed && !input.keyDraft) {
    return notReady('needs-key', i18n.t('engine.status.notConfigured'), false);
  }
  if (model.trim() === '') {
    return notReady('needs-model', keyStatus || i18n.t('engine.status.noModel'), true);
  }
  if (!keyed)
    return {
      status: isBuiltinEngine(engine)
        ? i18n.t('engine.status.unsaved')
        : i18n.t('engine.status.noKey'),
      mono: false,
      attention: false,
    };
  return { status: keyStatus, mono, attention: false };
}

/** Shown for a custom provider without a name. */
const UNNAMED_CUSTOM_SHORT = '自';

/**
 * A custom provider's short label: the first two characters of its name, by grapheme so
 * an emoji or accent is never cut in half; a generic one when it has no name.
 */
export function customShort(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return UNNAMED_CUSTOM_SHORT;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...segmenter.segment(trimmed)]
    .slice(0, 2)
    .map((part) => part.segment)
    .join('');
}
