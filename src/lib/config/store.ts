import { type AppError, type Result, toAppError } from '@/lib/errors';
import { deepEqual } from './merge';
import type { ConfigChange, ConfigPath, ConfigSnapshot } from './types';

export type ConfigState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: ConfigSnapshot }
  | { status: 'error'; error: AppError };

export interface ConfigStoreDeps {
  read(): Promise<ConfigSnapshot>;
  watch(callback: (snapshot: ConfigSnapshot) => void): () => void;
  patch(changes: ConfigChange[]): Promise<Result<ConfigSnapshot>>;
  reset(paths?: ConfigPath[]): Promise<Result<ConfigSnapshot>>;
}

export interface ConfigStore {
  subscribe(listener: () => void): () => void;
  /** Same reference until the content actually changes (useSyncExternalStore contract). */
  getSnapshot(): ConfigState;
  patch(changes: ConfigChange[]): Promise<Result<ConfigSnapshot>>;
  reset(paths?: ConfigPath[]): Promise<Result<ConfigSnapshot>>;
  dispose(): void;
}

/**
 * React-free store behind useConfig. Holds no optimistic state: the value is
 * always the last storage snapshot, and writes come back through `watch`.
 */
export function createConfigStore(deps: ConfigStoreDeps): ConfigStore {
  let state: ConfigState = { status: 'loading' };
  const listeners = new Set<() => void>();
  let unwatch: (() => void) | undefined;
  /** Bumped by dispose so reads started before it cannot land afterwards. */
  let epoch = 0;

  function setState(next: ConfigState) {
    if (
      next.status === 'ready' &&
      state.status === 'ready' &&
      deepEqual(next.snapshot, state.snapshot)
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener();
  }

  function start() {
    // A running watch is enough, except after a failed read: retry that read.
    if (unwatch && state.status !== 'error') return;
    unwatch ??= deps.watch((snapshot) => setState({ status: 'ready', snapshot }));
    const started = epoch;
    deps.read().then(
      (snapshot) => {
        // A watch event may already have delivered something newer.
        if (started === epoch && state.status !== 'ready') setState({ status: 'ready', snapshot });
      },
      (error: unknown) => {
        if (started === epoch && state.status !== 'ready') {
          setState({ status: 'error', error: toAppError(error) });
        }
      },
    );
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    patch: (changes) => deps.patch(changes),
    reset: (paths) => deps.reset(paths),
    dispose() {
      unwatch?.();
      unwatch = undefined;
      listeners.clear();
      epoch += 1;
      state = { status: 'loading' };
    },
  };
}
