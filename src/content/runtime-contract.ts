import type { ConfigV1 } from '@/lib/config/types';
import type { DetectedLanguages } from '@/lib/languages';
import type { EngineOptions, PageState, PageStatus } from '@/lib/messaging/protocol';
import type { PageSession } from './session';

// The seam between the always-loaded bootstrap and the on-demand page runtime.
// Types and side-effect-free constants only: both bundles import this file.

/** The runtime module registers its factory under `Symbol.for(PAGE_RUNTIME_KEY)`. */
export const PAGE_RUNTIME_KEY = 'islet-translate.page-runtime';

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

/** The selection runtime registers its factory under `Symbol.for(SELECTION_RUNTIME_KEY)`. */
export const SELECTION_RUNTIME_KEY = 'islet-translate.selection-runtime';

/** What the bootstrap lends the selection runtime. The runtime opens its own Port. */
export interface SelectionRuntimeDeps {
  getConfig(): Promise<ConfigV1>;
  watchConfig(callback: (config: ConfigV1) => void): () => void;
  /** Engines the card can offer; rejects when the background cannot answer. */
  listEngines(): Promise<EngineOptions>;
  /** `i18n.detectLanguage`; rejects when unavailable. */
  detectLanguage(text: string): Promise<DetectedLanguages>;
}

/** A frozen copy of the selection taken by the bootstrap. */
export interface SelectionSnapshot {
  /** The visible text, whitespace-normalized (4.3 rule 1 of the plan). */
  source: string;
  /** The selection's rectangles united, in viewport coordinates. */
  rect: { left: number; top: number; right: number; bottom: number };
  /** Where the dot goes: the last character's bottom right (its line's bottom edge). */
  anchor: { x: number; y: number };
  /** Where the pointer was released, when a pointer made the selection (not the keyboard). */
  pointer?: { x: number; y: number };
  /**
   * A copy of the selection's range: the card follows it while the page scrolls and
   * remembers it when closed. Absent when the selection could not be read as a range.
   */
  range?: Range;
}

export interface SelectionRuntime {
  /** Shows the dot at the selection; nothing is requested until the card opens. */
  showDot(selection: SelectionSnapshot): void;
  /** The selection went away (after the bootstrap's grace period): remove the dot. */
  hideDot(): void;
  /**
   * Opens the card. `selection` is the top-level selection when there is one; otherwise
   * only `source` is known (iframe or shortcut) and the card sits in the upper third.
   */
  open(args: { source: string; selection?: SelectionSnapshot }): void;
  /** Closes the card if one is open (the shortcut with no selection), pinned or not. */
  close(): void;
  /** Removes everything it added; the runtime is unusable afterwards. */
  dispose(): void;
}

export type SelectionRuntimeFactory = (deps: SelectionRuntimeDeps) => SelectionRuntime;
