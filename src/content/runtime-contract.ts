import type { ConfigV1 } from '@/lib/config/types';
import type { EngineOptions, PageState, PageStatus } from '@/lib/messaging/protocol';
import type { PageSession } from './session';

// The seam between the always-loaded bootstrap and the on-demand page runtime.
// Types and side-effect-free constants only: both bundles import this file.

/** The runtime module registers its factory under `Symbol.for(PAGE_RUNTIME_KEY)`. */
export const PAGE_RUNTIME_KEY = 'easy-translate.page-runtime';

/** Stateless functions the bootstrap lends to the runtime; there is one copy of each. */
export interface PageRuntimeDeps {
  getConfig(): Promise<ConfigV1>;
  watchConfig(callback: (config: ConfigV1) => void): () => void;
  reportStatus(status: PageStatus): void;
  /** Engines the isle can offer; rejects when the background cannot answer. */
  listEngines(): Promise<EngineOptions>;
}

export type PageRuntimeFactory = (deps: PageRuntimeDeps) => PageSession;

/** What a session that never started reports (equal to a fresh session's `state()`). */
export const IDLE_PAGE_STATE: Readonly<PageState> = {
  phase: 'idle',
  mode: 'bilingual',
  translated: 0,
  failed: 0,
};
