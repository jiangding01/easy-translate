import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { createStyleReader } from '@/content/dom-rules';
import { PAGE_RUNTIME_KEY, type PageRuntimeFactory } from '@/content/runtime-contract';
import { createPageSession } from '@/content/session';
import { createIntersectionViewport } from '@/content/viewport';
import { createPortClient } from '@/lib/messaging/port';
import { TRANSLATE_PORT_NAME } from '@/lib/messaging/port-name';
import type { TranslateChunk, TranslateDone, TranslateRequest } from '@/lib/messaging/protocol';

// Loaded on demand by the content script (see content/loader). Evaluating this
// file must only register the factory: no DOM, no config, no Port. It must not
// import runtime values from `protocol.ts` or `config/client.ts` (the bootstrap
// lends those through `deps`), nor reference any extension resource address.

const createPageRuntime: PageRuntimeFactory = (deps) =>
  createPageSession({
    win: window,
    port: createPortClient<TranslateRequest, TranslateChunk, TranslateDone>(() =>
      browser.runtime.connect({ name: TRANSLATE_PORT_NAME }),
    ),
    getConfig: deps.getConfig,
    watchConfig: deps.watchConfig,
    reportStatus: deps.reportStatus,
    createReadStyle: () => createStyleReader(window),
    createViewport: createIntersectionViewport,
  });

export default defineUnlistedScript(() => {
  (globalThis as Record<symbol, unknown>)[Symbol.for(PAGE_RUNTIME_KEY)] = createPageRuntime;
});
