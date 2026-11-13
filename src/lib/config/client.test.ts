import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readConfig, watchConfig } from './client';

vi.mock('@/lib/languages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/languages')>()),
  browserUiLanguage: () => 'ko-KR',
}));

const defaults = { ui: { theme: 'system' }, language: { target: 'ko' } };
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
      ui: { theme: 'dark' },
      language: { target: 'ko' },
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
      data: { ui: { theme: 'light' }, language: { target: 'ja' } },
    });

    unwatch();
    await fakeBrowser.storage.local.set({ config: { schemaVersion: 1, data: {} } });
    await flush();
    expect(callback).toHaveBeenCalledOnce();
  });
});
