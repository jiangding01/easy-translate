import type { ConfigV1, Engine } from '@/lib/config/types';
import { ENGINES } from '@/lib/config/types';
import { type AppError, appError, type Result } from '@/lib/errors';
import { handle } from '@/lib/messaging/handle';
import type {
  CacheStatsInfo,
  ProviderTestDraft,
  ProviderTestResult,
  SecretProviderId,
  SecretStatusInfo,
} from '@/lib/messaging/protocol';
import { forbiddenSenderError } from '@/lib/messaging/sender';
import type { TranslationCache } from './cache';
import { checkEngineEndpoint } from './permissions';
import { buildPrompt } from './prompt';
import { getAdapter as registryAdapter, resolveProviderSettings } from './providers/registry';
import type { Scheduler } from './scheduler';
import { cleanApiKey, SECRET_PROVIDERS, type SecretStore } from './secrets';
import type { ProviderAdapter } from './types';

// Background-only handlers for the settings page. Plain functions over injected
// dependencies, so tests need neither a browser nor real messaging.

export const TEST_SAMPLE = 'Hello, world.';

export interface AdminSender {
  url?: string;
}

export interface AdminDeps {
  getConfig(): Promise<ConfigV1>;
  secrets: Pick<SecretStore, 'get' | 'set' | 'status'>;
  cache: Pick<TranslationCache, 'stats' | 'clear'>;
  scheduler: Pick<Scheduler, 'submit'>;
  /** `browser.runtime.getURL('/options.html')`. */
  optionsUrl: string;
  getAdapter?: (engine: ProviderTestDraft['engine']) => ProviderAdapter;
  checkPermission?: (engine: Engine, baseURL: string) => Promise<Result<unknown>>;
  now?: () => number;
  randomId?: () => string;
}

function invalidPayload(): AppError {
  return appError('validation', 'validation/invalid-payload', 'Malformed request');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProvider(value: unknown): value is SecretProviderId {
  return (SECRET_PROVIDERS as readonly unknown[]).includes(value);
}

/** Accepts only pages of this extension's options page (`options.html`, with query or hash). */
export function isOptionsSender(sender: AdminSender | undefined, optionsUrl: string): boolean {
  const url = sender?.url;
  if (typeof url !== 'string') return false;
  if (!url.startsWith(optionsUrl)) return false;
  const next = url.charAt(optionsUrl.length);
  return next === '' || next === '?' || next === '#';
}

function parseDraft(raw: unknown): ProviderTestDraft {
  if (!isRecord(raw)) throw invalidPayload();
  const { engine, baseURL, model, apiKey } = raw;
  if (
    !(ENGINES as readonly unknown[]).includes(engine) ||
    typeof baseURL !== 'string' ||
    typeof model !== 'string' ||
    (apiKey !== undefined && typeof apiKey !== 'string')
  ) {
    throw invalidPayload();
  }
  return { engine: engine as ProviderTestDraft['engine'], baseURL, model, apiKey };
}

export function createAdminHandlers(deps: AdminDeps) {
  const getAdapter = deps.getAdapter ?? registryAdapter;
  const checkPermission = deps.checkPermission ?? checkEngineEndpoint;
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? (() => crypto.randomUUID());

  const guard = (sender: AdminSender | undefined) => {
    if (!isOptionsSender(sender, deps.optionsUrl)) throw forbiddenSenderError();
  };

  async function testProvider(rawDraft: unknown): Promise<ProviderTestResult> {
    const draft = parseDraft(rawDraft);
    const { engine } = draft;
    const model = draft.model.trim();
    if (engine !== 'google' && model === '') {
      throw appError('config', 'config/model-required', 'Model is required');
    }
    // Only the draft's own fields are used: nothing is read from or written to the config.
    const settings = resolveProviderSettings(engine, {
      openai: { baseURL: draft.baseURL, model },
      deepseek: { model },
      gemini: { model },
      custom: { baseURL: draft.baseURL, model },
    });
    const permission = await checkPermission(engine, settings.baseURL);
    if (!permission.ok) throw permission.error;

    // The draft key lives in this stack frame only.
    const draftKey = draft.apiKey === undefined ? '' : cleanApiKey(draft.apiKey);
    const apiKey =
      engine === 'google'
        ? undefined
        : draftKey || (await deps.secrets.get(engine as SecretProviderId));
    const redact = (text: string) => (draftKey ? text.split(draftKey).join('***') : text);

    const config = await deps.getConfig();
    const adapter = getAdapter(engine);
    const prompt =
      adapter.kind === 'llm'
        ? buildPrompt({ source: 'auto', target: config.language.target })
        : undefined;
    const startedAt = now();
    const [outcome] = deps.scheduler.submit({
      caller: `provider-test-${randomId()}`,
      signal: new AbortController().signal,
      engine,
      // Own cooldown and probe scope: a rate-limited test never pauses real translations.
      cooldownKey: `test:${randomId()}`,
      adapter,
      context: { source: 'auto', target: config.language.target, settings, apiKey, prompt },
      segments: [{ key: `test:${randomId()}`, text: TEST_SAMPLE }],
      // No persist: a connection test never touches the cache.
    });
    const result = outcome ? await outcome : undefined;
    if (!result) throw appError('internal', 'internal/unexpected', 'No test result');
    if (!result.ok) {
      const { error } = result;
      throw { ...error, message: redact(error.message) } satisfies AppError;
    }
    return { latencyMs: Math.max(0, now() - startedAt), text: redact(result.text) };
  }

  const wrap =
    <A extends unknown[], T>(fn: (...args: A) => T | Promise<T>) =>
    (sender: AdminSender | undefined, ...args: A): Promise<Result<T>> =>
      handle(async () => {
        guard(sender);
        return fn(...args);
      })();

  return {
    'secrets.set': wrap(
      (args: { provider: SecretProviderId; key: string | null }): Promise<SecretStatusInfo> => {
        if (!isRecord(args) || !isProvider(args.provider)) throw invalidPayload();
        if (args.key !== null && typeof args.key !== 'string') throw invalidPayload();
        return deps.secrets.set(args.provider, args.key);
      },
    ),
    'secrets.status': wrap(
      (): Promise<Record<SecretProviderId, SecretStatusInfo>> => deps.secrets.status(),
    ),
    'provider.test': wrap(testProvider),
    'cache.stats': wrap((): Promise<CacheStatsInfo> => deps.cache.stats()),
    'cache.clear': wrap(async () => {
      await deps.cache.clear();
      return null;
    }),
  };
}

export type AdminHandlers = ReturnType<typeof createAdminHandlers>;
