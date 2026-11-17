import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { SELECTION_RUNTIME_KEY, type SelectionRuntimeFactory } from '@/content/runtime-contract';
import { createSelectionCard } from '@/content/selection/card';
import { createPortClient } from '@/lib/messaging/port';
import { TRANSLATE_PORT_NAME } from '@/lib/messaging/port-name';
import type { TranslateChunk, TranslateDone, TranslateRequest } from '@/lib/messaging/protocol';

// Loaded on demand by the content script (see content/loader), like page-runtime.ts.
// Evaluating this file must only register the factory: no DOM, no config, no Port.
// Same limits: no runtime imports from `protocol.ts` or `config/client.ts` (the bootstrap
// lends them through `deps`), no reference to any extension resource address. The card
// opens its own Port, independent of the page session's (plan 4.2 rule 4).

const createSelectionRuntime: SelectionRuntimeFactory = (deps) =>
  createSelectionCard({
    deps,
    // Connects on the first request, not here.
    port: createPortClient<TranslateRequest, TranslateChunk, TranslateDone>(() =>
      browser.runtime.connect({ name: TRANSLATE_PORT_NAME }),
    ),
    env: {
      win: window,
      speech: {
        synth: window.speechSynthesis,
        createUtterance: (text) => new SpeechSynthesisUtterance(text),
      },
    },
  });

export default defineUnlistedScript(() => {
  (globalThis as Record<symbol, unknown>)[Symbol.for(SELECTION_RUNTIME_KEY)] =
    createSelectionRuntime;
});
