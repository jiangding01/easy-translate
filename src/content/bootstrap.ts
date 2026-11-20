import { appError } from '@/lib/errors';
import { handle } from '@/lib/messaging/handle';
import type { onMessage, PageInfo, PageState } from '@/lib/messaging/protocol';
import {
  IDLE_PAGE_STATE,
  type PageRuntimeDeps,
  type PageRuntimeFactory,
  type SelectionRuntime,
  type SelectionRuntimeDeps,
  type SelectionRuntimeFactory,
  type SelectionSnapshot,
} from './runtime-contract';
import { decideOpen } from './selection/open';
import type { PageSession } from './session';

// The always-loaded half of the content script: answers popup/background messages and
// loads the page runtime only when a session is actually needed (and the selection runtime
// only when a dot or card is). The state of
// `sessionPromise` is the session state: none / loading / ready. A failed load clears
// it so nothing pins the failure; Chrome caches a failed module import per URL, so in
// practice recovery needs a page reload, which the page-unreachable message asks for.

export interface BootstrapDeps {
  onMessage: typeof onMessage;
  pageInfo(): PageInfo;
  loadFactory(): Promise<PageRuntimeFactory>;
  runtime: PageRuntimeDeps;
  selection: {
    loadFactory(): Promise<SelectionRuntimeFactory>;
    runtime: SelectionRuntimeDeps;
    /** The top document's selection, extracted; undefined when there is none. */
    read(): SelectionSnapshot | undefined;
    /** `document.hasFocus()`. */
    hasFocus(): boolean;
    /**
     * Whether the extension context is still valid (`browser.runtime.id` is set). After an
     * update or reload the old page's script lives on with every extension API dead.
     */
    alive?(): boolean;
    /**
     * The context is gone for good: stop watching the selection. Called once; a loaded
     * selection runtime is then told to hide its dot.
     */
    onContextLost?(): void;
  };
}

/** The error Chrome throws from extension APIs once the context is invalidated. */
const CONTEXT_INVALIDATED = /context invalidated/i;

export interface Bootstrap {
  /**
   * Loads the page runtime and lets it start unless the page is already in the target
   * language or a session is already running; the auto-start entry point.
   */
  autoStart(): Promise<void>;
  /** Shows the selection dot, loading the selection runtime on first use; never throws. */
  showDot(selection: SelectionSnapshot): void;
  /** Removes the dot; does nothing when the selection runtime was never loaded. */
  hideDot(): void;
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
        console.warn('[islet-translate] page runtime failed to load', cause);
        throw appError('network', 'network/page-unreachable', 'Page runtime failed to load');
      }
    })();
    sessionPromise = pending;
    return pending;
  }

  let selectionPromise: Promise<SelectionRuntime> | undefined;
  let contextLost = false;

  /** Whether the extension context is gone; the first time, the selection watch stops. */
  function isContextLost(cause?: unknown): boolean {
    if (contextLost) return true;
    const dead =
      deps.selection.alive?.() === false ||
      (cause !== undefined && CONTEXT_INVALIDATED.test(String(cause)));
    if (!dead) return false;
    contextLost = true;
    deps.selection.onContextLost?.();
    // The watch is stopped now, so no later hideDot would reach the runtime: a dot (or a
    // parked one, waiting to scroll back) would outlive the extension.
    hideDot();
    return true;
  }

  function hideDot() {
    selectionPromise?.then((runtime) => runtime.hideDot()).catch(() => {});
  }

  function loadSelection(): Promise<SelectionRuntime> {
    if (selectionPromise) return selectionPromise;
    let pending: Promise<SelectionRuntime> | undefined;
    pending = (async () => {
      await Promise.resolve();
      try {
        const create = await deps.selection.loadFactory();
        return create(deps.selection.runtime);
      } catch (cause) {
        if (selectionPromise === pending) selectionPromise = undefined;
        // The extension was updated or reloaded: expected, and nothing will load again.
        if (!isContextLost(cause)) {
          console.warn('[islet-translate] selection runtime failed to load', cause);
        }
        throw appError('network', 'network/page-unreachable', 'Selection runtime failed to load');
      }
    })();
    selectionPromise = pending;
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

  // Handled in the top frame only (the content script runs nowhere else).
  deps.onMessage(
    'selection.open',
    handle(async ({ data }) => {
      const decision = decideOpen({
        selectionText: data?.selectionText,
        frameId: data?.frameId,
        hasFocus: deps.selection.hasFocus(),
        top: deps.selection.read(),
      });
      switch (decision.kind) {
        case 'ignore':
          break;
        case 'close':
          // Nothing to close unless the runtime was ever loaded.
          if (selectionPromise) (await selectionPromise).close();
          break;
        case 'top':
          (await loadSelection()).open({
            source: decision.selection.source,
            selection: decision.selection,
          });
          break;
        case 'detached':
          (await loadSelection()).open({ source: decision.source });
          break;
      }
      return null;
    }),
  );

  return {
    showDot(selection) {
      if (isContextLost()) return;
      loadSelection()
        .then((runtime) => runtime.showDot(selection))
        .catch(() => {
          // Already logged; a dot is a convenience.
        });
    },
    hideDot,
    async autoStart() {
      await (await load()).autoStart();
    },
  };
}
