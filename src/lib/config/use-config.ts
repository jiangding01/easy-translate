import { useSyncExternalStore } from 'react';
import { patchConfig, readConfig, resetConfig, watchConfig } from './client';
import { type ConfigState, createConfigStore } from './store';

const store = createConfigStore({
  read: readConfig,
  watch: watchConfig,
  patch: patchConfig,
  reset: resetConfig,
});

/** Config for extension pages: `state` mirrors storage, `patch` goes through the background. */
export function useConfig(): {
  state: ConfigState;
  patch: typeof store.patch;
  reset: typeof store.reset;
} {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { state, patch: store.patch, reset: store.reset };
}
