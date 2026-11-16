import { appError } from '@/lib/errors';
import { PAGE_RUNTIME_KEY, type PageRuntimeFactory } from './runtime-contract';

export interface LoaderDeps {
  /** `browser.runtime.getURL`; throws once the extension context is invalidated. */
  getURL(path: string): string;
  importModule(url: string): Promise<unknown>;
}

/**
 * Imports the on-demand page runtime and returns its factory. The address is
 * resolved on every call: it is never cached, and the module must not know it.
 */
export async function loadPageRuntime(deps: LoaderDeps): Promise<PageRuntimeFactory> {
  await deps.importModule(deps.getURL('/page-runtime.js'));
  const factory = (globalThis as Record<symbol, unknown>)[Symbol.for(PAGE_RUNTIME_KEY)];
  if (typeof factory !== 'function') {
    throw appError('internal', 'internal/runtime-missing', 'Page runtime did not register');
  }
  return factory as PageRuntimeFactory;
}
