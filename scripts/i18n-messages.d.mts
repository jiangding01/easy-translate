// Types for scripts/i18n-messages.mjs (imported by vitest.setup.ts).

export interface LocaleFile {
  locale: string;
  file: string;
  messages: unknown[];
}

export type GetMessage = (name: string, substitutions?: string | (string | number)[]) => string;

export const LOCALES_DIR: string;
export const DEFAULT_LOCALE: string;
export function localeOf(file: string): string;
export function loadLocales(dir?: string): Promise<LocaleFile[]>;
export function chromeMessages(messages: unknown[]): Record<string, string>;
export function predefinedMessages(locale: string): Record<string, string>;
export function substitute(text: string, substitutions?: string | (string | number)[]): string;
export function createGetMessage(
  locales: LocaleFile[],
  locale: string,
  defaultLocale?: string,
): GetMessage;
