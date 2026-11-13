import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ConfigChange, ConfigPath, ConfigSnapshot } from '@/lib/config/types';
import type { AppError, Result } from '@/lib/errors';
import type { LanguageCode } from '@/lib/languages';

export interface PageInfo {
  title: string;
  /** `<html lang>`; empty when the page does not declare one. */
  language: string;
}

/**
 * One-shot messages between contexts. Every reply is a `Result`: handlers are
 * wrapped with `handle()` and senders go through `call()`, so nothing throws
 * across a context boundary. Payloads are not validated: every sender is this
 * extension's own code (config writes are validated by the repository).
 */
export interface ProtocolMap {
  'app.getStatus'(): Result<{ version: string }>;
  'config.patch'(changes: ConfigChange[]): Result<ConfigSnapshot>;
  'config.reset'(paths?: ConfigPath[]): Result<ConfigSnapshot>;
  /** popup → top frame (frameId 0) of a given tab. */
  'page.getInfo'(): Result<PageInfo>;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();

// ---------------------------------------------------------------- Port et-translate

/** Long-lived Port served by the background: req → chunk* → done (see lib/messaging/port). */
export const TRANSLATE_PORT_NAME = 'et-translate';

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
