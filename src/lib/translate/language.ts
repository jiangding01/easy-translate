import { browser } from 'wxt/browser';
import {
  DETECT_MIN_LENGTH,
  DETECT_MIN_PERCENTAGE,
  type DetectedLanguages,
  isTargetLanguage,
  type LanguageCode,
} from '@/lib/languages';

export type { DetectedLanguages };
export { DETECT_MIN_LENGTH, DETECT_MIN_PERCENTAGE };

export type DetectLanguage = (text: string) => Promise<DetectedLanguages>;

/** Detection is an optimization: when it is slow, translate instead of waiting. */
export const DETECT_TIMEOUT_MS = 200;

/**
 * `chrome.i18n.detectLanguage`, looked up at call time. Whether it exists in a
 * service worker is not documented: a missing API simply rejects.
 */
export const detectWithBrowser: DetectLanguage = async (text) => {
  const i18n = (browser as { i18n?: { detectLanguage?: unknown } }).i18n;
  if (typeof i18n?.detectLanguage !== 'function') throw new Error('detectLanguage unavailable');
  return (await (i18n.detectLanguage as DetectLanguage).call(i18n, text)) as DetectedLanguages;
};

/** Drops HTML tags and {{n}} placeholders so markup does not pass for English. */
export function stripForDetection(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\{\s*\d+\s*\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SameLanguageCheck = (text: string, target: LanguageCode) => Promise<boolean>;

/**
 * True only when detection is reliable, its top language covers at least 80% of
 * the text and equals the target after normalization (Simplified and
 * Traditional Chinese stay distinct). Mixed-language text is translated.
 * Short texts, timeouts, a missing API and errors all mean "translate".
 */
export function createSameLanguageCheck(
  detect: DetectLanguage | undefined = detectWithBrowser,
  timeoutMs = DETECT_TIMEOUT_MS,
): SameLanguageCheck {
  return async (text, target) => {
    if (!detect) return false;
    const plain = stripForDetection(text);
    if (plain.length < DETECT_MIN_LENGTH) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => detect(plain)), timeout]);
      return isTargetLanguage(plain, result, target);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}
