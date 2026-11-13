import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createLocalStore } from './local-store';
import { createConfigRepository, type KeyValueStore } from './repository';
import type { ConfigChange } from './types';

const uiLanguage = 'en-US';

function memoryStore(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  const store: KeyValueStore & { data: Map<string, unknown>; failNextSet: boolean } = {
    data,
    failNextSet: false,
    async get(key) {
      await Promise.resolve();
      return structuredClone(data.get(key));
    },
    async set(key, value) {
      await Promise.resolve();
      if (store.failNextSet) {
        store.failNextSet = false;
        throw new Error('quota exceeded');
      }
      data.set(key, structuredClone(value));
    },
  };
  return store;
}

const valid = (data: Record<string, unknown>) => ({ config: { schemaVersion: 1, data } });

describe('ConfigRepository', () => {
  it('writes defaults on first load', async () => {
    const store = memoryStore();
    const snapshot = await createConfigRepository({ store, uiLanguage }).load();
    expect(snapshot).toEqual({
      schemaVersion: 1,
      data: { ui: { theme: 'system' }, language: { target: 'en' } },
    });
    expect(store.data.get('config')).toEqual(snapshot);
  });

  it('does not write when stored data is already valid', async () => {
    const store = memoryStore(valid({ ui: { theme: 'dark' }, language: { target: 'ja' } }));
    const set = vi.spyOn(store, 'set');
    await createConfigRepository({ store, uiLanguage }).load();
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps both of two concurrent patches to different fields', async () => {
    const store = memoryStore();
    const repo = createConfigRepository({ store, uiLanguage });
    await Promise.all([
      repo.patch([{ path: 'ui.theme', value: 'dark' }]),
      repo.patch([{ path: 'language.target', value: 'ko' }]),
    ]);
    expect(store.data.get('config')).toMatchObject({
      data: { ui: { theme: 'dark' }, language: { target: 'ko' } },
    });
  });

  it('does not lose a patch that races with the load write-back', async () => {
    const store = memoryStore({ config: 'corrupted' });
    const repo = createConfigRepository({ store, uiLanguage });
    const [, patched] = await Promise.all([
      repo.load(),
      repo.patch([{ path: 'ui.theme', value: 'light' }]),
    ]);
    expect(patched.data.ui.theme).toBe('light');
    expect(store.data.get('config')).toMatchObject({ data: { ui: { theme: 'light' } } });
  });

  it('patches stored data that is missing fields or has an unrelated broken field', async () => {
    const store = memoryStore(valid({ ui: { theme: 'neon' }, future: { keep: true } }));
    const repo = createConfigRepository({ store, uiLanguage });
    const snapshot = await repo.patch([{ path: 'language.target', value: 'zh-TW' }]);
    expect(snapshot.data).toEqual({
      ui: { theme: 'system' },
      language: { target: 'zh-TW' },
      future: { keep: true },
    });
  });

  it('rejects an invalid value and leaves the store unchanged', async () => {
    const initial = valid({ ui: { theme: 'dark' }, language: { target: 'ja' } });
    const store = memoryStore(initial);
    const repo = createConfigRepository({ store, uiLanguage });
    const change = { path: 'ui.theme', value: 'neon' } as unknown as ConfigChange;
    await expect(repo.patch([change])).rejects.toMatchObject({ code: 'config/invalid-value' });
    expect(store.data.get('config')).toEqual(initial.config);
  });

  it('rejects a path outside the whitelist', async () => {
    const store = memoryStore();
    const repo = createConfigRepository({ store, uiLanguage });
    const change = { path: 'ui', value: {} } as unknown as ConfigChange;
    await expect(repo.patch([change])).rejects.toMatchObject({ code: 'config/unknown-path' });
    expect(store.data.has('config')).toBe(false);
  });

  it('reports a failed write, keeps the store, and keeps serving later patches', async () => {
    const initial = valid({ ui: { theme: 'dark' }, language: { target: 'ja' } });
    const store = memoryStore(initial);
    const repo = createConfigRepository({ store, uiLanguage });
    store.failNextSet = true;
    await expect(repo.patch([{ path: 'ui.theme', value: 'light' }])).rejects.toMatchObject({
      code: 'config/write-failed',
      retryable: true,
    });
    expect(store.data.get('config')).toEqual(initial.config);
    await repo.patch([{ path: 'ui.theme', value: 'light' }]);
    expect(store.data.get('config')).toMatchObject({ data: { ui: { theme: 'light' } } });
  });

  it('resets a single path and all paths, keeping unknown keys', async () => {
    const store = memoryStore(valid({ ui: { theme: 'dark' }, language: { target: 'ja' }, x: 1 }));
    const repo = createConfigRepository({ store, uiLanguage });
    expect((await repo.reset(['ui.theme'])).data).toEqual({
      ui: { theme: 'system' },
      language: { target: 'ja' },
      x: 1,
    });
    expect((await repo.reset()).data).toEqual({
      ui: { theme: 'system' },
      language: { target: 'en' },
      x: 1,
    });
  });

  it('reads the last write from a fresh instance (simulated SW restart)', async () => {
    const store = createLocalStore();
    await createConfigRepository({ store, uiLanguage }).patch([
      { path: 'language.target', value: 'ko' },
    ]);
    const restarted = createConfigRepository({ store, uiLanguage });
    expect((await restarted.load()).data.language.target).toBe('ko');
    expect(await fakeBrowser.storage.local.get('config')).toMatchObject({
      config: { schemaVersion: 1, data: { language: { target: 'ko' } } },
    });
  });

  it('refuses patch and reset in read-only mode and never writes on load', async () => {
    const newer = { config: { schemaVersion: 2, data: { brandNew: true } } };
    const store = memoryStore(newer);
    const set = vi.spyOn(store, 'set');
    const repo = createConfigRepository({ store, uiLanguage });
    expect((await repo.load()).data.ui.theme).toBe('system');
    await expect(repo.patch([{ path: 'ui.theme', value: 'dark' }])).rejects.toMatchObject({
      code: 'config/newer-version',
    });
    await expect(repo.reset()).rejects.toMatchObject({ code: 'config/newer-version' });
    expect(set).not.toHaveBeenCalled();
    expect(store.data.get('config')).toEqual(newer.config);
  });
});
