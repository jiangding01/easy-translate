import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createLocalStore } from './local-store';
import { createConfigRepository, type KeyValueStore } from './repository';
import { EXTRA_DEFAULTS } from './test-fixtures';
import { type ConfigChange, type CustomProviderId, MAX_CUSTOM_PROVIDERS } from './types';

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
const full = (ui: unknown, language: unknown, extra: Record<string, unknown> = {}) =>
  valid({ ui, language, ...EXTRA_DEFAULTS, ...extra });

describe('ConfigRepository', () => {
  it('writes defaults on first load', async () => {
    const store = memoryStore();
    const snapshot = await createConfigRepository({ store, uiLanguage }).load();
    expect(snapshot).toEqual({
      schemaVersion: 1,
      data: {
        ui: { theme: 'system' },
        language: { target: 'en', source: 'auto' },
        ...EXTRA_DEFAULTS,
      },
    });
    expect(store.data.get('config')).toEqual(snapshot);
  });

  it('does not write when stored data is already valid', async () => {
    const store = memoryStore(full({ theme: 'dark' }, { target: 'ja', source: 'auto' }));
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
      language: { target: 'zh-TW', source: 'auto' },
      ...EXTRA_DEFAULTS,
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

  it('patches the engine, source language and provider fields, and rejects an unknown engine', async () => {
    const store = memoryStore();
    const repo = createConfigRepository({ store, uiLanguage });
    const snapshot = await repo.patch([
      { path: 'translation.engine', value: 'gemini' },
      { path: 'language.source', value: 'ja' },
      { path: 'providers.gemini.model', value: 'some-model' },
    ]);
    expect(snapshot.data.translation.engine).toBe('gemini');
    expect(snapshot.data.language.source).toBe('ja');
    expect(snapshot.data.providers.gemini.model).toBe('some-model');

    const bad = { path: 'translation.engine', value: 'bing' } as unknown as ConfigChange;
    await expect(repo.patch([bad])).rejects.toMatchObject({ code: 'config/invalid-value' });
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
    expect((await repo.reset(['ui.theme'])).data).toMatchObject({
      ui: { theme: 'system' },
      language: { target: 'ja' },
      x: 1,
    });
    expect((await repo.reset()).data).toMatchObject({
      ui: { theme: 'system' },
      language: { target: 'en', source: 'auto' },
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

describe('ConfigRepository: custom providers', () => {
  const entry = (name: string) => ({ name, baseURL: `https://${name}.example.com/v1`, model: 'm' });
  const add = (key: CustomProviderId, name: string): ConfigChange => ({
    path: 'customProviders',
    key,
    value: entry(name),
  });
  const remove = (key: CustomProviderId): ConfigChange => ({
    path: 'customProviders',
    key,
    value: null,
  });

  it('adds, replaces in place and removes single entries', async () => {
    const repo = createConfigRepository({ store: memoryStore(), uiLanguage });
    await repo.patch([add('custom-aaaaaaaa', 'a')]);
    await repo.patch([add('custom-bbbbbbbb', 'b')]);
    const replaced = await repo.patch([add('custom-aaaaaaaa', 'a2')]);
    expect(Object.keys(replaced.data.customProviders)).toEqual([
      'custom-aaaaaaaa',
      'custom-bbbbbbbb',
    ]);
    expect(replaced.data.customProviders['custom-aaaaaaaa']?.name).toBe('a2');
    const removed = await repo.patch([remove('custom-aaaaaaaa')]);
    expect(Object.keys(removed.data.customProviders)).toEqual(['custom-bbbbbbbb']);
  });

  it('keeps concurrent edits of different entries', async () => {
    const repo = createConfigRepository({ store: memoryStore(), uiLanguage });
    await Promise.all([
      repo.patch([add('custom-aaaaaaaa', 'a')]),
      repo.patch([add('custom-bbbbbbbb', 'b')]),
    ]);
    const { data } = await repo.load();
    expect(Object.keys(data.customProviders).sort()).toEqual([
      'custom-aaaaaaaa',
      'custom-bbbbbbbb',
    ]);
  });

  it('can make a new entry the default in the same patch', async () => {
    const repo = createConfigRepository({ store: memoryStore(), uiLanguage });
    const snapshot = await repo.patch([
      add('custom-aaaaaaaa', 'a'),
      { path: 'translation.engine', value: 'custom-aaaaaaaa' },
    ]);
    expect(snapshot.data.translation.engine).toBe('custom-aaaaaaaa');
  });

  it('falls back to Google when the default provider is removed', async () => {
    const repo = createConfigRepository({ store: memoryStore(), uiLanguage });
    await repo.patch([
      add('custom-aaaaaaaa', 'a'),
      { path: 'translation.engine', value: 'custom-aaaaaaaa' },
    ]);
    const snapshot = await repo.patch([remove('custom-aaaaaaaa')]);
    expect(snapshot.data.translation.engine).toBe('google');
  });

  it('turns a default engine that does not exist into Google', async () => {
    const repo = createConfigRepository({ store: memoryStore(), uiLanguage });
    await expect(
      repo.patch([{ path: 'translation.engine', value: 'custom-zzzzzzzz' }]),
    ).resolves.toMatchObject({ data: { translation: { engine: 'google' } } });
  });

  it(`stops at ${MAX_CUSTOM_PROVIDERS} entries but still allows replacing one`, async () => {
    const store = memoryStore();
    const repo = createConfigRepository({ store, uiLanguage });
    const ids = Array.from(
      { length: MAX_CUSTOM_PROVIDERS },
      (_, index) => `custom-${String(index).padStart(8, '0')}` as CustomProviderId,
    );
    await repo.patch(ids.map((id) => add(id, id)));
    await expect(repo.patch([add('custom-zzzzzzzz', 'z')])).rejects.toMatchObject({
      code: 'config/provider-limit',
    });
    await expect(repo.patch([add(ids[0] as CustomProviderId, 'again')])).resolves.toBeDefined();
  });

  it('rejects malformed ids and values, and replacing the whole record', async () => {
    const store = memoryStore();
    const repo = createConfigRepository({ store, uiLanguage });
    const badId = {
      path: 'customProviders',
      key: 'custom',
      value: entry('a'),
    } as unknown as ConfigChange;
    await expect(repo.patch([badId])).rejects.toMatchObject({ code: 'config/invalid-value' });
    const badValue = {
      path: 'customProviders',
      key: 'custom-aaaaaaaa',
      value: { name: 'x'.repeat(41), baseURL: '', model: '' },
    } as unknown as ConfigChange;
    await expect(repo.patch([badValue])).rejects.toMatchObject({ code: 'config/invalid-value' });
    const whole = { path: 'customProviders', value: {} } as unknown as ConfigChange;
    await expect(repo.patch([whole])).rejects.toMatchObject({ code: 'config/unknown-path' });
    expect(store.data.has('config')).toBe(false);
  });
});
