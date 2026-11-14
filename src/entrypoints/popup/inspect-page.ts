import { browser } from 'wxt/browser';
import { appError, fail, type Result } from '@/lib/errors';
import { call } from '@/lib/messaging/handle';
import { type PageInfo, sendMessage } from '@/lib/messaging/protocol';

export interface ActivePage {
  /** Host of the active tab ('' when unknown); for browser pages, the scheme-less URL. */
  host: string;
  info: Result<PageInfo>;
  /** Set for http(s) pages only. */
  tabId?: number;
  origin?: string;
}

function hostLabel(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.host || `${parsed.protocol}//`;
  } catch {
    return '';
  }
}

/** Asks the top frame of the active tab for its info; restricted pages fail fast. */
export async function inspectActivePage(): Promise<ActivePage> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const host = hostLabel(tab?.url);
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) {
    return {
      host,
      info: fail(appError('validation', 'validation/unsupported-page', 'Not an http(s) page')),
    };
  }
  const tabId = tab.id;
  const origin = new URL(tab.url).origin;
  const info = await call(
    () => sendMessage('page.getInfo', undefined, { tabId, frameId: 0 }),
    // Retrying cannot help: the user has to reload the page to get a content script.
    appError('network', 'network/page-unreachable', 'Content script is unreachable', {
      retryable: false,
    }),
  );
  return { host, info, tabId, origin };
}
