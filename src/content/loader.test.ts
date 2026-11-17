import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRuntime } from './loader';
import {
  PAGE_RUNTIME_KEY,
  type PageRuntimeFactory,
  SELECTION_RUNTIME_KEY,
  type SelectionRuntimeFactory,
} from './runtime-contract';

const slot = Symbol.for(PAGE_RUNTIME_KEY);
const selectionSlot = Symbol.for(SELECTION_RUNTIME_KEY);
const globals = globalThis as Record<symbol, unknown>;

const load = (
  options: Pick<Parameters<typeof loadRuntime>[0], 'getURL' | 'importModule'> &
    Partial<Parameters<typeof loadRuntime>[0]>,
) =>
  loadRuntime<PageRuntimeFactory>({ path: '/page-runtime.js', key: PAGE_RUNTIME_KEY, ...options });

afterEach(() => {
  delete globals[slot];
  delete globals[selectionSlot];
});

describe('loadRuntime', () => {
  it('imports the module and returns the factory it registered', async () => {
    const factory: PageRuntimeFactory = vi.fn();
    const importModule = vi.fn(async () => {
      globals[slot] = factory;
    });
    const getURL = vi.fn(() => 'chrome-extension://abc/page-runtime.js');
    expect(await load({ getURL, importModule })).toBe(factory);
    expect(getURL).toHaveBeenCalledWith('/page-runtime.js');
    expect(importModule).toHaveBeenCalledWith('chrome-extension://abc/page-runtime.js');
  });

  // The dynamic URL is stable within a browser session but may change when the extension
  // reloads, so the loader asks for it each time instead of caching it.
  it('calls getURL on every load instead of caching the address', async () => {
    globals[slot] = vi.fn();
    const getURL = vi.fn().mockReturnValueOnce('u1').mockReturnValueOnce('u2');
    const importModule = vi.fn(async () => undefined);
    await load({ getURL, importModule });
    await load({ getURL, importModule });
    expect(importModule.mock.calls).toEqual([['u1'], ['u2']]);
  });

  it('rejects when the context is invalidated (getURL throws)', async () => {
    const importModule = vi.fn();
    await expect(
      load({
        getURL: () => {
          throw new Error('Extension context invalidated.');
        },
        importModule,
      }),
    ).rejects.toThrow('Extension context invalidated.');
    expect(importModule).not.toHaveBeenCalled();
  });

  it('rejects when the import fails', async () => {
    await expect(
      load({
        getURL: () => 'u',
        importModule: () => Promise.reject(new Error('Failed to fetch')),
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('reports internal/runtime-missing when the module did not register', async () => {
    await expect(
      load({ getURL: () => 'u', importModule: async () => undefined }),
    ).rejects.toMatchObject({ kind: 'internal', code: 'internal/runtime-missing' });
  });

  it('loads a second module by its own path and key', async () => {
    const factory: SelectionRuntimeFactory = vi.fn();
    globals[selectionSlot] = factory;
    const page: PageRuntimeFactory = vi.fn();
    globals[slot] = page;
    const getURL = vi.fn((path: string) => `chrome-extension://abc${path}`);
    const importModule = vi.fn(async () => undefined);
    expect(
      await loadRuntime<SelectionRuntimeFactory>({
        path: '/selection-runtime.js',
        key: SELECTION_RUNTIME_KEY,
        getURL,
        importModule,
      }),
    ).toBe(factory);
    expect(importModule).toHaveBeenCalledWith('chrome-extension://abc/selection-runtime.js');
  });

  it("does not take another module's factory for the requested one", async () => {
    globals[slot] = vi.fn();
    await expect(
      loadRuntime({
        path: '/selection-runtime.js',
        key: SELECTION_RUNTIME_KEY,
        getURL: () => 'u',
        importModule: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'internal/runtime-missing' });
  });
});
