import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { inspectActivePage } from './inspect-page';

vi.mock('@/lib/messaging/protocol', () => ({
  sendMessage: vi.fn(() => Promise.reject(new Error('Receiving end does not exist'))),
}));

describe('inspectActivePage', () => {
  it('reports an unreachable content script as non-retryable (the user must reload the page)', async () => {
    const tab = { id: 1, url: 'https://example.com/' } as Browser.tabs.Tab;
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((() => Promise.resolve([tab])) as never);
    const result = await inspectActivePage();
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'network/page-unreachable', retryable: false }),
    });
  });
});
