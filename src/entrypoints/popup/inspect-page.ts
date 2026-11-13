import { browser } from 'wxt/browser';
import { appError, fail, type Result } from '@/lib/errors';
import { call } from '@/lib/messaging/handle';
import { type PageInfo, sendMessage } from '@/lib/messaging/protocol';

/** Asks the top frame of the active tab for its info; restricted pages fail fast. */
export async function inspectActivePage(): Promise<Result<PageInfo>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) {
    return fail(appError('validation', 'validation/unsupported-page', 'Not an http(s) page'));
  }
  const tabId = tab.id;
  return call(
    () => sendMessage('page.getInfo', undefined, { tabId, frameId: 0 }),
    // Retrying cannot help: the user has to reload the page to get a content script.
    appError('network', 'network/page-unreachable', 'Content script is unreachable', {
      retryable: false,
    }),
  );
}
