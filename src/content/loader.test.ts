import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPageRuntime } from './loader';
import { PAGE_RUNTIME_KEY, type PageRuntimeFactory } from './runtime-contract';

const slot = Symbol.for(PAGE_RUNTIME_KEY);
const globals = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete globals[slot];
});

describe('loadPageRuntime', () => {
  it('imports the module and returns the factory it registered', async () => {
    const factory: PageRuntimeFactory = vi.fn();
    const importModule = vi.fn(async () => {
      globals[slot] = factory;
    });
    const getURL = vi.fn(() => 'chrome-extension://abc/page-runtime.js');
    expect(await loadPageRuntime({ getURL, importModule })).toBe(factory);
    expect(getURL).toHaveBeenCalledWith('/page-runtime.js');
    expect(importModule).toHaveBeenCalledWith('chrome-extension://abc/page-runtime.js');
  });

  // The dynamic URL is stable within a browser session but may change when the extension
  // reloads, so the loader asks for it each time instead of caching it.
  it('calls getURL on every load instead of caching the address', async () => {
    globals[slot] = vi.fn();
    const getURL = vi.fn().mockReturnValueOnce('u1').mockReturnValueOnce('u2');
    const importModule = vi.fn(async () => undefined);
    await loadPageRuntime({ getURL, importModule });
    await loadPageRuntime({ getURL, importModule });
    expect(importModule.mock.calls).toEqual([['u1'], ['u2']]);
  });

  it('rejects when the context is invalidated (getURL throws)', async () => {
    const importModule = vi.fn();
    await expect(
      loadPageRuntime({
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
      loadPageRuntime({
        getURL: () => 'u',
        importModule: () => Promise.reject(new Error('Failed to fetch')),
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('reports internal/runtime-missing when the module did not register', async () => {
    await expect(
      loadPageRuntime({ getURL: () => 'u', importModule: async () => undefined }),
    ).rejects.toMatchObject({ kind: 'internal', code: 'internal/runtime-missing' });
  });
});
