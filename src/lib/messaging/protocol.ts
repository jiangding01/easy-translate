import { defineExtensionMessaging } from '@webext-core/messaging';
import type {
  ConfigChange,
  ConfigPath,
  ConfigSnapshot,
  CustomProviderId,
  Engine,
  PageMode,
} from '@/lib/config/types';
import type { AppError, Result } from '@/lib/errors';
import type { LanguageCode } from '@/lib/languages';
import type { SiteMemory } from '@/lib/site-memory';

export interface PageInfo {
  title: string;
  /** `<html lang>`; empty when the page does not declare one. */
  language: string;
}

/** Built-in engines that take a key, or a custom provider id. */
export type SecretProviderId = 'openai' | 'deepseek' | 'gemini' | CustomProviderId;

/** Never carries the key itself: `last4` is empty for short keys. */
export interface SecretStatusInfo {
  configured: boolean;
  last4: string;
}

/**
 * Unsaved settings-page values; `apiKey` falls back to the key saved for `engine`
 * when omitted or blank. A custom id need not exist in the config yet.
 */
export interface ProviderTestDraft {
  engine: Engine;
  baseURL: string;
  model: string;
  apiKey?: string;
}

export interface ProviderTestResult {
  latencyMs: number;
  text: string;
}

/** A page-translation session as the toolbar panel sees it (content script → popup). */
export interface PageState {
  phase: 'idle' | 'running' | 'done';
  mode: PageMode;
  /** Units with a rendered translation. */
  translated: number;
  /** Units whose last attempt failed and can be retried. */
  failed: number;
  /** Engine-level problem that paused the session; it is shown once, not per paragraph. */
  engineError?: AppError;
  /** One-off engine used by this session instead of the configured one. */
  engine?: Engine;
}

/** Status the content script reports so the toolbar icon can show its dot. */
export type PageStatus = 'idle' | 'running' | 'done' | 'error';

export interface CacheStatsInfo {
  count: number;
  totalBytes: number;
}

/**
 * One-shot messages between contexts. Every reply is a `Result`: handlers are
 * wrapped with `handle()` and senders go through `call()`, so nothing throws
 * across a context boundary. Payloads are not validated: every sender is this
 * extension's own code (config writes are validated by the repository, and
 * accepted from extension pages only).
 */
export interface ProtocolMap {
  'app.getStatus'(): Result<{ version: string }>;
  'config.patch'(changes: ConfigChange[]): Result<ConfigSnapshot>;
  'config.reset'(paths?: ConfigPath[]): Result<ConfigSnapshot>;
  /** Settings page only (`validation/forbidden-sender` otherwise). */
  'secrets.set'(args: { provider: SecretProviderId; key: string | null }): Result<SecretStatusInfo>;
  /** Every built-in provider, plus each custom provider that has a key. */
  'secrets.status'(): Result<Partial<Record<SecretProviderId, SecretStatusInfo>>>;
  'provider.test'(draft: ProviderTestDraft): Result<ProviderTestResult>;
  'cache.stats'(): Result<CacheStatsInfo>;
  'cache.clear'(): Result<null>;
  /** popup → top frame (frameId 0) of a given tab. */
  'page.getInfo'(): Result<PageInfo>;
  /** popup → content (frameId 0): page-translation session control. */
  'page.getState'(): Result<PageState>;
  'page.start'(args: { engine?: Engine }): Result<PageState>;
  'page.stop'(): Result<PageState>;
  'page.setMode'(mode: PageMode): Result<PageState>;
  'page.retryFailed'(): Result<PageState>;
  /** background → content: the translate-page shortcut. */
  'page.toggle'(): Result<PageState>;
  /** content → background: drives the toolbar icon's status dot for the sender tab. */
  'page.status'(status: PageStatus): Result<null>;
  /** extension pages → background: "总是翻译此站". */
  'site.setAlways'(args: { origin: string; always: boolean }): Result<SiteMemory>;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();

// ---------------------------------------------------------------- Port et-translate

export { TRANSLATE_PORT_NAME } from './port-name';

/** Larger payloads are rejected with `validation/payload-too-large`. */
export const TRANSLATE_PAYLOAD_LIMITS = { maxItems: 200, maxChars: 50_000 } as const;

export interface TranslateItem {
  id: string;
  text: string;
}

export interface TranslateRequest {
  items: TranslateItem[];
  /** Defaults to the configured source / target language. */
  source?: LanguageCode | 'auto';
  target?: LanguageCode;
  /** One-off engine for this request ("这次先用 Google"); never written to the config. */
  engine?: Engine;
}

/**
 * - `translated`: `text` is the translation.
 * - `unchanged`: nothing to translate (blank input) or the translation equals the source.
 * - `same-language`: detected as already in the target language; `text` is the source.
 */
export type TranslateDisposition = 'translated' | 'unchanged' | 'same-language';

/** One per item, in completion order. */
export type TranslateChunk =
  | { id: string; text: string; disposition: TranslateDisposition; cached: boolean }
  | { id: string; error: AppError };

export interface TranslateDone {
  total: number;
  failed: number;
}
