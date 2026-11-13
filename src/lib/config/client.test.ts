import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readConfig, watchConfig } from './client';
import { EXTRA_DEFAULTS } from './test-fixtures';

vi.mock('@/lib/languages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/languages')>()),
  browserUiLanguage: () => 'ko-KR',
}));

const defaults = {
  ui: { theme: 'system' },
  language: { target: 'ko', source: 'auto' },
  ...EXTRA_DEFAULTS,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('readConfig', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await readConfig()).toEqual({ schemaVersion: 1, data: defaults });
  });

  it('merges stored data with defaults', async () => {
    await fakeBrowser.storage.local.set({
      config: { schemaVersion: 1, data: { ui: { theme: 'dark' } } },
    });
    expect((await readConfig()).data).toEqual({
      ...defaults,
      ui: { theme: 'dark' },
    });
  });

  it('uses defaults for a newer schemaVersion', async () => {
    await fakeBrowser.storage.local.set({
      config: { schemaVersion: 2, data: { ui: { theme: 'dark' } } },
    });
    expect((await readConfig()).data).toEqual(defaults);
  });

  it('guards enum values it does not know', async () => {
    await fakeBrowser.storage.local.set({
      config: { schemaVersion: 1, data: { ui: { theme: 'neon' }, language: { target: 'xx' } } },
    });
    expect((await readConfig()).data).toEqual(defaults);
  });

  it('guards the engine and source language enums', async () => {
    await fakeBrowser.storage.local.set({
      config: {
        schemaVersion: 1,
        data: { language: { source: 'klingon' }, translation: { engine: 'bing' } },
      },
    });
    const { data } = await readConfig();
    expect(data.language.source).toBe('auto');
    expect(data.translation.engine).toBe('google');

    await fakeBrowser.storage.local.set({
      config: {
        schemaVersion: 1,
        data: { language: { source: 'ja' }, translation: { engine: 'gemini' } },
      },
    });
    const next = (await readConfig()).data;
    expect(next.language.source).toBe('ja');
    expect(next.translation.engine).toBe('gemini');
  });

  it('fills the provider defaults when they are missing', async () => {
    await fakeBrowser.storage.local.set({
      config: { schemaVersion: 1, data: { providers: { openai: { model: 'x' } } } },
    });
    const { data } = await readConfig();
    expect(data.providers.openai).toEqual({ baseURL: 'https://api.openai.com/v1', model: 'x' });
    expect(data.providers.custom).toEqual({ baseURL: '', model: '' });
  });
});

describe('watchConfig', () => {
  it('fires on config changes only, and stops after unsubscribe', async () => {
    const callback = vi.fn();
    const unwatch = watchConfig(callback);

    await fakeBrowser.storage.local.set({ other: 1 });
    await flush();
    expect(callback).not.toHaveBeenCalled();

    await fakeBrowser.storage.local.set({
      config: { schemaVersion: 1, data: { ui: { theme: 'light' }, language: { target: 'ja' } } },
    });
    await flush();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      data: { ...defaults, ui: { theme: 'light' }, language: { target: 'ja', source: 'auto' } },
    });

    unwatch();
    await fakeBrowser.storage.local.set({ config: { schemaVersion: 1, data: {} } });
    await flush();
    expect(callback).toHaveBeenCalledOnce();
  });
});
