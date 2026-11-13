import type { ConfigV1, Engine } from '@/lib/config/types';
import { type AppError, appError, type Result } from '@/lib/errors';
import { isLanguageCode, type LanguageCode } from '@/lib/languages';
import {
  TRANSLATE_PAYLOAD_LIMITS,
  type TranslateChunk,
  type TranslateDisposition,
  type TranslateDone,
  type TranslateItem,
  type TranslateRequest,
} from '@/lib/messaging/protocol';
import type { TranslationCache } from './cache';
import { makeCacheKey } from './cache-key';
import { createSameLanguageCheck, type DetectLanguage, detectWithBrowser } from './language';
import { checkEngineEndpoint } from './permissions';
import { buildPrompt, promptDigest } from './prompt';
import { abortedError } from './providers/errors';
import { getAdapter as registryAdapter, resolveProviderSettings } from './providers/registry';
import { createScheduler, type Scheduler } from './scheduler';
import type { SecretStore } from './secrets';
import type { ProviderAdapter } from './types';

export interface TranslateServiceDeps {
  /** Current configuration (the background passes the repository's snapshot data). */
  getConfig(): Promise<ConfigV1>;
  secrets: Pick<SecretStore, 'get'>;
  cache: TranslationCache;
  getAdapter?: (engine: Engine) => ProviderAdapter;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  /** `null` disables detection; omitted uses chrome.i18n.detectLanguage. */
  detectLanguage?: DetectLanguage | null;
  /** Endpoint gate (built-in origin, or https/localhost with the host permission). */
  checkPermission?: (engine: Engine, baseURL: string) => Promise<Result<unknown>>;
  /** Shared scheduler; by default the service creates its own. */
  scheduler?: Scheduler;
}

export interface TranslateContext {
  /** Aborted on cancel or disconnect. */
  signal: AbortSignal;
  emit(chunk: TranslateChunk): void;
  /** Fairness group (one per Port). Defaults to a group per request. */
  caller?: string;
}

export interface TranslateService {
  translate(payload: TranslateRequest, ctx: TranslateContext): Promise<TranslateDone>;
  readonly scheduler: Scheduler;
}

const ZERO_WIDTH = /[​-‍﻿]/g;

/** Drops zero-width characters (U+200B–U+200D, U+FEFF), then trims. */
export function preprocessText(text: string): string {
  return text.replace(ZERO_WIDTH, '').trim();
}

function comparable(text: string): string {
  return preprocessText(text).replace(/\s+/g, ' ').toLowerCase();
}

/** `unchanged` when the translation equals the source after trim, whitespace folding and case folding. */
export function classifyTranslation(
  source: string,
  translation: string,
): Extract<TranslateDisposition, 'translated' | 'unchanged'> {
  return comparable(source) === comparable(translation) ? 'unchanged' : 'translated';
}

function invalidPayloadError(): AppError {
  return appError('validation', 'validation/invalid-payload', 'Malformed translate request');
}

export function payloadTooLargeError(): AppError {
  return appError('validation', 'validation/payload-too-large', 'Too many items or characters');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates the untrusted payload shape and size. Throws AppError. */
export function parseTranslateRequest(payload: unknown): TranslateRequest {
  if (!isRecord(payload) || !Array.isArray(payload.items)) throw invalidPayloadError();
  const items: TranslateItem[] = [];
  let chars = 0;
  for (const item of payload.items) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.text !== 'string') {
      throw invalidPayloadError();
    }
    chars += item.text.length;
    items.push({ id: item.id, text: item.text });
  }
  if (
    items.length > TRANSLATE_PAYLOAD_LIMITS.maxItems ||
    chars > TRANSLATE_PAYLOAD_LIMITS.maxChars
  ) {
    throw payloadTooLargeError();
  }
  const { source, target } = payload;
  if (source !== undefined && source !== 'auto' && !isLanguageCode(source)) {
    throw invalidPayloadError();
  }
  if (target !== undefined && !isLanguageCode(target)) throw invalidPayloadError();
  return { items, source, target };
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortedError();
}

interface Pending {
  id: string;
  raw: string;
  text: string;
}

/**
 * Port `et-translate` handler logic: preprocess, same-language skip, cache
 * lookup, then one scheduler submission; emits one chunk per item and resolves
 * with `{ total, failed }`. Results reach the cache through the scheduler, so
 * they are stored even when this caller has gone away.
 */
export function createTranslateService(deps: TranslateServiceDeps): TranslateService {
  const scheduler =
    deps.scheduler ?? createScheduler({ fetch: deps.fetch, now: deps.now, random: deps.random });
  const getAdapter = deps.getAdapter ?? registryAdapter;
  const isSameLanguage = createSameLanguageCheck(
    deps.detectLanguage === undefined ? detectWithBrowser : (deps.detectLanguage ?? undefined),
  );
  const checkPermission = deps.checkPermission ?? checkEngineEndpoint;
  const { cache } = deps;
  let sequence = 0;

  async function translate(payload: TranslateRequest, ctx: TranslateContext) {
    const request = parseTranslateRequest(payload);
    const { signal } = ctx;
    const caller = ctx.caller ?? `request-${++sequence}`;
    throwIfAborted(signal);

    let failed = 0;
    const emit = (chunk: TranslateChunk) => {
      if (signal.aborted) return;
      if ('error' in chunk) failed += 1;
      ctx.emit(chunk);
    };
    const done = (): TranslateDone => ({ total: request.items.length, failed });

    // 1. Preprocess: blank items are returned as they are, without a request.
    const pending: Pending[] = [];
    for (const item of request.items) {
      const text = preprocessText(item.text);
      if (text === '') {
        emit({ id: item.id, text: item.text, disposition: 'unchanged', cached: false });
      } else {
        pending.push({ id: item.id, raw: item.text, text });
      }
    }
    if (pending.length === 0) return done();

    const config = await deps.getConfig();
    throwIfAborted(signal);
    const source: LanguageCode | 'auto' = request.source ?? config.language.source;
    const target: LanguageCode = request.target ?? config.language.target;
    const engine = config.translation.engine;
    const adapter = getAdapter(engine);
    const settings = resolveProviderSettings(engine, config.providers);

    // 2. Same-language skip (only when the source is detected).
    let candidates = pending;
    if (source === 'auto') {
      const same = await Promise.all(pending.map((item) => isSameLanguage(item.text, target)));
      throwIfAborted(signal);
      candidates = [];
      pending.forEach((item, index) => {
        if (same[index]) {
          emit({ id: item.id, text: item.raw, disposition: 'same-language', cached: false });
        } else {
          candidates.push(item);
        }
      });
      if (candidates.length === 0) return done();
    }

    // 3. Cache lookup.
    const prompt = adapter.kind === 'llm' ? buildPrompt({ source, target }) : undefined;
    const digest = prompt ? await promptDigest(prompt) : '';
    const keyed = await Promise.all(
      candidates.map(async (item) => ({
        ...item,
        key: await makeCacheKey({
          engine,
          endpoint: settings.baseURL,
          model: settings.model,
          source,
          target,
          promptDigest: digest,
          paramsDigest: '',
          text: item.text,
        }),
      })),
    );
    const hits = await cache.getMany([...new Set(keyed.map((item) => item.key))]);
    throwIfAborted(signal);
    const misses: typeof keyed = [];
    for (const item of keyed) {
      const hit = hits.get(item.key);
      if (hit === undefined) misses.push(item);
      else {
        emit({
          id: item.id,
          text: hit,
          disposition: classifyTranslation(item.text, hit),
          cached: true,
        });
      }
    }

    try {
      if (misses.length === 0) return done();

      // 4. Preconditions shared by every remaining item.
      const permission = await checkPermission(engine, settings.baseURL);
      throwIfAborted(signal);
      if (!permission.ok) {
        for (const item of misses) emit({ id: item.id, error: permission.error });
        return done();
      }
      const apiKey = engine === 'google' ? undefined : await deps.secrets.get(engine);
      throwIfAborted(signal);

      // 5. Schedule; chunks are emitted as segments finish.
      const outcomes = scheduler.submit({
        caller,
        signal,
        engine,
        adapter,
        context: { source, target, settings, apiKey, prompt },
        segments: misses.map((item) => ({ key: item.key, text: item.text })),
        persist: (entries) => cache.put(entries),
      });
      await Promise.all(
        outcomes.map(async (pendingOutcome, index) => {
          const outcome = await pendingOutcome;
          const item = misses[index];
          if (!item) return;
          if (outcome.ok) {
            emit({
              id: item.id,
              text: outcome.text,
              disposition: classifyTranslation(item.text, outcome.text),
              cached: false,
            });
          } else {
            emit({ id: item.id, error: outcome.error });
          }
        }),
      );
      throwIfAborted(signal);
      return done();
    } finally {
      // One batched lastUsedAt refresh per request; best effort.
      if (hits.size > 0) void cache.touch([...hits.keys()]);
    }
  }

  return { translate, scheduler };
}
