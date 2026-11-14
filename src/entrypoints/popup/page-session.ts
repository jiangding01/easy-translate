import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Engine, PageMode } from '@/lib/config/types';
import { type AppError, appError, fail, type Result } from '@/lib/errors';
import { call } from '@/lib/messaging/handle';
import { type PageState, sendMessage } from '@/lib/messaging/protocol';
import { readSiteMemory, SITE_MEMORY_KEY, siteEntry } from '@/lib/site-memory';

// The panel's view of the page-translation session in the active tab, plus the
// two things around it: the shortcut and "总是翻译此站".

const POLL_MS = 500;

/** Short reason shown in the paused notice; the full sentence lives in the title. */
export function pausedReason(error: AppError): string {
  switch (error.code) {
    case 'provider/unauthorized':
      return '密钥无效';
    case 'provider/quota-exceeded':
      return '额度已用完';
    case 'provider/local-origin-rejected':
      return '本地服务拒绝了请求';
    case 'config/permission-missing':
      return '还没有授权访问接口';
    default:
      return '设置不完整';
  }
}

export interface PageSessionControls {
  state: PageState | undefined;
  start(engine?: Engine): Promise<Result<PageState>>;
  stop(): Promise<Result<PageState>>;
  setMode(mode: PageMode): Promise<Result<PageState>>;
  retryFailed(): Promise<Result<PageState>>;
}

export function usePageSession(tabId: number | undefined): PageSessionControls {
  const [state, setState] = useState<PageState>();

  const run = useCallback(
    async (send: (to: { tabId: number; frameId: number }) => Promise<Result<PageState>>) => {
      if (tabId === undefined) return fail(appError('internal', 'internal/no-tab', 'No tab'));
      const result = await call(() => send({ tabId, frameId: 0 }));
      if (result.ok) setState(result.data);
      return result;
    },
    [tabId],
  );

  useEffect(() => {
    void run((to) => sendMessage('page.getState', undefined, to));
  }, [run]);

  // While translating, follow progress; stops by itself once done or closed.
  const running = state?.phase === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void run((to) => sendMessage('page.getState', undefined, to));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, run]);

  return {
    state,
    start: (engine) => run((to) => sendMessage('page.start', { engine }, to)),
    stop: () => run((to) => sendMessage('page.stop', undefined, to)),
    setMode: (mode) => run((to) => sendMessage('page.setMode', mode, to)),
    retryFailed: () => run((to) => sendMessage('page.retryFailed', undefined, to)),
  };
}

/** The shortcut Chrome actually assigned: '' when none, undefined while loading. */
export function useShortcut(): string | undefined {
  const [shortcut, setShortcut] = useState<string>();
  useEffect(() => {
    browser.commands
      .getAll()
      .then((commands) => {
        const command = commands.find((item) => item.name === 'translate-page');
        setShortcut(command?.shortcut ?? '');
      })
      .catch(() => setShortcut(''));
  }, []);
  return shortcut;
}

export function useSiteAlways(origin: string | undefined) {
  const [always, setAlways] = useState<boolean>();
  useEffect(() => {
    if (!origin) return;
    const read = (raw: unknown) =>
      setAlways(siteEntry(readSiteMemory(raw), origin)?.always === true);
    void browser.storage.local
      .get(SITE_MEMORY_KEY)
      .then((stored) => read(stored[SITE_MEMORY_KEY]))
      .catch(() => setAlways(false));
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && SITE_MEMORY_KEY in changes) read(changes[SITE_MEMORY_KEY]?.newValue);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [origin]);

  const toggle = async (): Promise<Result<unknown> | undefined> => {
    if (!origin || always === undefined) return undefined;
    const next = !always;
    setAlways(next);
    const result = await call(() => sendMessage('site.setAlways', { origin, always: next }));
    if (!result.ok) setAlways(!next);
    return result;
  };
  return { always, toggle };
}
