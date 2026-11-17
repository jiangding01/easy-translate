import { i18n } from '#i18n';

/**
 * The locale of the UI copy Chrome picked (`meta.locale`: en, zh-CN), which is not always the
 * browser language: a de or zh-HK browser gets the en copy. Extension pages and background
 * only; the on-demand content modules use content/i18n.ts.
 */
export function uiLocale(): string {
  // Empty only if the message is missing (Chrome returns ""): the default locale's code.
  return i18n.t('meta.locale') || 'en';
}

/** Extension pages: `<html lang>` follows the UI copy (screen reader voice, font choice). */
export function applyUiLocale(doc: Document): void {
  doc.documentElement.lang = uiLocale();
}
