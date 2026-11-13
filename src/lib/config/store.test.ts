import { describe, expect, it, vi } from 'vitest';
import { appError, ok } from '@/lib/errors';
import { createConfigStore } from './store';
import type { ConfigSnapshot } from './types';

const snapshot = (theme: 'system' | 'light' | 'dark'): ConfigSnapshot => ({
  schemaVersion: 1,
  data: { ui: { theme }, language: { target: 'en' } },
});

function setup(read: () => Promise<ConfigSnapshot>) {
  let push: (value: ConfigSnapshot) => void = () => undefined;
  const unwatch = vi.fn();
  const patch = vi.fn(async () => ok(snapshot('dark')));
  const store = createConfigStore({
    read,
    watch: (callback) => {
      push = callback;
      return unwatch;
    },
    patch,
    reset: vi.fn(async () => ok(snapshot('system'))),
  });
  return { store, push: (value: ConfigSnapshot) => push(value), unwatch, patch };
}

describe('config store', () => {
  it('goes loading → ready → pushed update', async () => {
    const { store, push } = setup(async () => snapshot('light'));
    const listener = vi.fn();
    expect(store.getSnapshot()).toEqual({ status: 'loading' });

    store.subscribe(listener);
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'));
    expect(store.getSnapshot()).toEqual({ status: 'ready', snapshot: snapshot('light') });

    push(snapshot('dark'));
    expect(store.getSnapshot()).toEqual({ status: 'ready', snapshot: snapshot('dark') });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('enters the error state when the first read fails', async () => {
    const { store } = setup(async () => {
      throw appError('config', 'config/read-failed', 'nope');
    });
    store.subscribe(() => undefined);
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('error'));
    expect(store.getSnapshot()).toMatchObject({ error: { code: 'config/read-failed' } });
  });

  it('keeps the same reference when content does not change', async () => {
    const { store, push } = setup(async () => snapshot('light'));
    const listener = vi.fn();
    store.subscribe(listener);
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'));

    const before = store.getSnapshot();
    push(snapshot('light'));
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not let a late read override a newer pushed value', async () => {
    let resolveRead: (value: ConfigSnapshot) => void = () => undefined;
    const { store, push } = setup(() => new Promise((resolve) => (resolveRead = resolve)));
    store.subscribe(() => undefined);
    push(snapshot('dark'));
    resolveRead(snapshot('light'));
    await Promise.resolve();
    expect(store.getSnapshot()).toEqual({ status: 'ready', snapshot: snapshot('dark') });
  });

  it('forwards patch without touching local state, and stops watching on dispose', async () => {
    const { store, patch, unwatch } = setup(async () => snapshot('light'));
    store.subscribe(() => undefined);
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'));
    const before = store.getSnapshot();
    await store.patch([{ path: 'ui.theme', value: 'dark' }]);
    expect(patch).toHaveBeenCalledWith([{ path: 'ui.theme', value: 'dark' }]);
    expect(store.getSnapshot()).toBe(before);
    store.dispose();
    expect(unwatch).toHaveBeenCalledOnce();
  });
});
