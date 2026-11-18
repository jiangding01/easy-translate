import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { createStyleReader } from '@/content/dom-rules';
import { createIsle } from '@/content/isle/isle';
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

const createPageRuntime: PageRuntimeFactory = (deps) => {
  const session = createPageSession({
    win: window,
    port: createPortClient<TranslateRequest, TranslateChunk, TranslateDone>(() =>
      browser.runtime.connect({ name: TRANSLATE_PORT_NAME }),
    ),
    getConfig: deps.getConfig,
    watchConfig: deps.watchConfig,
    reportStatus: deps.reportStatus,
    // Once the extension is reloaded or updated, `browser.i18n` is gone or throws. Probe
    // it instead of reading `runtime.id`: on-demand modules must not read the extension
    // id (anti-probing rule, enforced by `check:build`).
    alive: () => {
      try {
        browser.i18n.getUILanguage();
        return true;
      } catch {
        return false;
      }
    },
    createReadStyle: () => createStyleReader(window),
    createViewport: createIntersectionViewport,
  });
  // The isle follows the session through `subscribe` and drives it through its public
  // methods; it lives as long as the session (the page's lifetime).
  createIsle({ session, deps, env: { win: window } });
  return session;
};

export default defineUnlistedScript(() => {
  (globalThis as Record<symbol, unknown>)[Symbol.for(PAGE_RUNTIME_KEY)] = createPageRuntime;
});
