import { browser } from 'wxt/browser';

export const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const LANGUAGE_CODES = LANGUAGES.map((language) => language.code) as [
  LanguageCode,
  ...LanguageCode[],
];

const FALLBACK_LANGUAGE: LanguageCode = 'en';

/** Chinese tags that should read Traditional script. */
const TRADITIONAL_CHINESE = new Set(['hant', 'tw', 'hk', 'mo']);

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

export function languageName(code: LanguageCode): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? code;
}

/**
 * Maps a BCP 47-ish tag (`zh_cn`, `ZH-tw`, `en-US`) to a supported code,
 * or undefined when the language is not supported.
 */
export function normalizeLanguage(tag: string): LanguageCode | undefined {
  const parts = tag.trim().replaceAll('_', '-').toLowerCase().split('-').filter(Boolean);
  const [primary, ...rest] = parts;
  if (!primary) return undefined;
  if (primary === 'zh') {
    // An explicit Hans script wins over a Traditional-leaning region (zh-Hans-HK).
    if (rest.includes('hans')) return 'zh-CN';
    return rest.some((part) => TRADITIONAL_CHINESE.has(part)) ? 'zh-TW' : 'zh-CN';
  }
  return LANGUAGE_CODES.find((code) => code.toLowerCase() === primary);
}

export function defaultTargetLanguage(uiLanguage: string): LanguageCode {
  return normalizeLanguage(uiLanguage) ?? FALLBACK_LANGUAGE;
}

export function browserUiLanguage(): string {
  try {
    return browser.i18n.getUILanguage();
  } catch {
    return FALLBACK_LANGUAGE;
  }
}
