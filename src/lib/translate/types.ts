import type { LanguageCode } from '@/lib/languages';

// Background-only. Nothing under src/lib/translate may be imported by clients
// (popup, options UI, content scripts).

export type ProviderEvent =
  /** Complete translation of one item. */
  | { type: 'item'; index: number; text: string }
  /** Streaming increment of one item: not produced in M1 (used by M3 selection cards). */
  | { type: 'delta'; index: number; delta: string };

export interface BuiltPrompt {
  system: string;
  /** User message template; contains USER_INPUT_TOKEN, replaced by the encoded batch. */
  user: string;
  version: number;
}

/** Resolved provider settings: `baseURL` is normalized, `model` may be empty (Google ignores both). */
export interface ProviderSettings {
  baseURL: string;
  model: string;
}

export interface ProviderContext {
  signal: AbortSignal;
  source: LanguageCode | 'auto';
  target: LanguageCode;
  settings: ProviderSettings;
  apiKey?: string;
  /** Required by LLM adapters. */
  prompt?: BuiltPrompt;
  /**
   * Injectable fetch (defaults to globalThis.fetch). The scheduler passes a wrapper
   * that stops its response-header timer once the response arrives.
   */
  fetch?: typeof fetch;
  /** LLM streams: abort when no data arrives for this long after the first chunk. */
  idleTimeoutMs?: number;
}

export interface ProviderAdapter {
  kind: 'mt' | 'llm';
  limits: { maxItems: number; maxChars: number };
  /**
   * On normal completion exactly one `item` per index has been yielded; failures are
   * thrown as AppError.
   */
  translate(batch: string[], ctx: ProviderContext): AsyncIterable<ProviderEvent>;
}
