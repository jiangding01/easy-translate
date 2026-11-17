import { appError } from '@/lib/errors';

export interface LoadRuntimeOptions {
  /** Path of the on-demand module in the extension root, e.g. `/page-runtime.js`. */
  path: string;
  /** The module registers its factory under `Symbol.for(key)`. */
  key: string;
  /** `browser.runtime.getURL`; throws once the extension context is invalidated. */
  getURL(path: string): string;
  importModule(url: string): Promise<unknown>;
}

/**
 * Imports an on-demand module and returns the factory it registered. The address is
 * resolved on every call: it is never cached, and the module must not know it.
 */
export async function loadRuntime<T extends (...args: never[]) => unknown>(
  options: LoadRuntimeOptions,
): Promise<T> {
  await options.importModule(options.getURL(options.path));
  const factory = (globalThis as Record<symbol, unknown>)[Symbol.for(options.key)];
  if (typeof factory !== 'function') {
    throw appError(
      'internal',
      'internal/runtime-missing',
      `Runtime ${options.path} did not register`,
    );
  }
  return factory as T;
}
