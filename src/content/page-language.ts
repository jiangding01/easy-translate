import { type DetectedLanguages, type LanguageCode, normalizeLanguage } from '@/lib/languages';
import { SKIP_TAGS } from './dom-rules';

// "总是翻译此站" starts unless the page is already in the target language. This check
// lives in the page runtime, not the resident content script.

export interface LanguageCheckDeps {
  /** `<html lang>`, empty when undeclared. */
  declared: string;
  sample(): string;
  detect(text: string): Promise<DetectedLanguages>;
}

const SAMPLE_CHARS = 2000;

/** Up to 2000 characters of visible-ish text, without forcing layout (no innerText). */
export function sampleText(root: Element, limit = SAMPLE_CHARS): string {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  for (let node = walker.nextNode(); node && text.length < limit; node = walker.nextNode()) {
    const value = node.nodeValue?.replace(/\s+/g, ' ').trim();
    if (value) text += `${value} `;
  }
  return text.slice(0, limit);
}

/** True when the page is already in `target`; a declared `<html lang>` wins over detection. */
export async function pageIsInLanguage(
  target: LanguageCode,
  deps: LanguageCheckDeps,
): Promise<boolean> {
  const declared = deps.declared.trim();
  if (declared) return normalizeLanguage(declared) === target;
  const text = deps.sample();
  if (!text.trim()) return true;
  try {
    const { languages } = await deps.detect(text);
    const top = [...languages].sort((a, b) => b.percentage - a.percentage)[0];
    return top !== undefined && top.percentage >= 50 && normalizeLanguage(top.language) === target;
  } catch {
    // Unknown language: the user asked for this site, so translate.
    return false;
  }
}
