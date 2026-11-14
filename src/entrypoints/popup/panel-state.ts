import { type LanguageCode, normalizeLanguage } from '@/lib/languages';
import type { ActivePage } from './inspect-page';

export type PanelState =
  | { kind: 'loading' }
  /** Browser pages, the Web Store, file:// and the like. */
  | { kind: 'blocked' }
  /** No content script yet: the page was open before the extension was installed or updated. */
  | { kind: 'unreachable'; host: string }
  | { kind: 'native'; host: string; language: LanguageCode }
  | { kind: 'foreign'; host: string; language?: LanguageCode };

/** What the panel shows for the active tab. Pure; `page` is undefined while loading. */
export function panelState(page: ActivePage | undefined, target: LanguageCode): PanelState {
  if (!page) return { kind: 'loading' };
  const { host, info } = page;
  if (!info.ok) {
    return info.error.code === 'network/page-unreachable'
      ? { kind: 'unreachable', host }
      : { kind: 'blocked' };
  }
  const language = info.data.language ? normalizeLanguage(info.data.language) : undefined;
  if (language === target) return { kind: 'native', host, language };
  return { kind: 'foreign', host, language };
}
