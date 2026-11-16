import { appError } from '@/lib/errors';
import { handle } from '@/lib/messaging/handle';
import type { onMessage, PageInfo, PageState } from '@/lib/messaging/protocol';
import { IDLE_PAGE_STATE, type PageRuntimeDeps, type PageRuntimeFactory } from './runtime-contract';
import type { PageSession } from './session';

// The always-loaded half of the content script: answers popup/background messages and
// loads the page runtime only when a session is actually needed. The state of
// `sessionPromise` is the session state: none / loading / ready. A failed load clears
// it so nothing pins the failure; Chrome caches a failed module import per URL, so in
// practice recovery needs a page reload, which the page-unreachable message asks for.

export interface BootstrapDeps {
  onMessage: typeof onMessage;
  pageInfo(): PageInfo;
  loadFactory(): Promise<PageRuntimeFactory>;
  runtime: PageRuntimeDeps;
}

export interface Bootstrap {
  /** Starts a session unless one is already running; the auto-start entry point. */
  startIfIdle(): Promise<void>;
}

export function createBootstrap(deps: BootstrapDeps): Bootstrap {
  let sessionPromise: Promise<PageSession> | undefined;

  function load(): Promise<PageSession> {
    if (sessionPromise) return sessionPromise;
    let pending: Promise<PageSession> | undefined;
    pending = (async () => {
      // Defer one tick so a synchronous failure cannot clear the cache before it is set.
      await Promise.resolve();
      try {
        const create = await deps.loadFactory();
        return create(deps.runtime);
      } catch (cause) {
        if (sessionPromise === pending) sessionPromise = undefined;
        console.warn('[easy-translate] page runtime failed to load', cause);
        throw appError('network', 'network/page-unreachable', 'Page runtime failed to load');
      }
    })();
    sessionPromise = pending;
    return pending;
  }

  /** Never loads: with no session, the answer is the idle state. */
  async function withSession(
    run: (session: PageSession) => PageState | Promise<PageState>,
  ): Promise<PageState> {
    if (!sessionPromise) return { ...IDLE_PAGE_STATE };
    return run(await sessionPromise);
  }

  deps.onMessage('page.getInfo', handle(deps.pageInfo));
  deps.onMessage(
    'page.getState',
    handle(() => withSession((session) => session.state())),
  );
  // Answers as soon as the session is running, so the panel can close at once;
  // discovery continues in the page.
  deps.onMessage(
    'page.start',
    handle(async ({ data }) => {
      const session = await load();
      session.start(data ?? {}).catch(() => {
        // A failed start already restored the page; the panel shows idle next time.
      });
      return session.state();
    }),
  );
  deps.onMessage(
    'page.stop',
    handle(() => withSession((session) => session.stop())),
  );
  deps.onMessage(
    'page.toggle',
    handle(async () => (await load()).toggle()),
  );
  deps.onMessage(
    'page.setMode',
    handle(({ data }) => withSession((session) => session.setMode(data))),
  );
  deps.onMessage(
    'page.retryFailed',
    handle(() => withSession((session) => session.retryFailed())),
  );

  return {
    async startIfIdle() {
      const session = await load();
      if (session.state().phase === 'idle') await session.start();
    },
  };
}
