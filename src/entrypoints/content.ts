import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { startIfRemembered } from '@/content/auto-start';
import { createBootstrap } from '@/content/bootstrap';
import { createHoldWatch } from '@/content/hold/watch';
import { loadRuntime } from '@/content/loader';
import {
  PAGE_RUNTIME_KEY,
  type PageRuntimeFactory,
  SELECTION_RUNTIME_KEY,
  type SelectionRuntimeFactory,
} from '@/content/runtime-contract';
import { createSelectionWatch, readSelection } from '@/content/selection/watch';
import { readConfig, watchConfig } from '@/lib/config/client';
import type { ConfigV1 } from '@/lib/config/types';
import { onMessage, sendMessage } from '@/lib/messaging/protocol';
import { SITE_MEMORY_KEY } from '@/lib/site-memory';

// Runs on every page. The resident part is only the selection and hold-key watchers (a few
// listeners and cheap checks, content/selection/watch and content/hold/watch): until a dot,
// a card or a toggle is wanted it builds no Port and writes no DOM. The page runtime (session, scanner, renderer) and the selection
// runtime (dot, card) are separate files imported on first use; this entry only routes
// messages (content/bootstrap).

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  // WXT otherwise window.postMessage()s `${runtime.id}:...content-script-started` to the
  // page on every load, handing any site the extension ID. It only serves extensions
  // whose older builds listened for that message; ours never did.
  noScriptStartedPostMessage: true,
  main() {
    const getConfig = async () => (await readConfig()).data;
    const watchData = (callback: (config: ConfigV1) => void) =>
      watchConfig((snapshot) => callback(snapshot.data));
    const listEngines = async () => {
      const result = await sendMessage('engine.options');
      if (!result.ok) throw result.error;
      return result.data;
    };
    const bootstrap = createBootstrap({
      onMessage,
      pageInfo: () => ({
        title: document.title,
        language: document.documentElement.lang,
      }),
      loadFactory: () =>
        loadRuntime<PageRuntimeFactory>({
          path: '/page-runtime.js',
          key: PAGE_RUNTIME_KEY,
          getURL: (path) => browser.runtime.getURL(path as '/page-runtime.js'),
          importModule: (url) => import(/* @vite-ignore */ url),
        }),
      runtime: {
        getConfig,
        watchConfig: watchData,
        listEngines,
        reportStatus: (status) => {
          sendMessage('page.status', status).catch(() => {
            // Background unreachable or extension reloaded: the dot is cosmetic.
          });
        },
      },
      selection: {
        loadFactory: () =>
          loadRuntime<SelectionRuntimeFactory>({
            path: '/selection-runtime.js',
            key: SELECTION_RUNTIME_KEY,
            getURL: (path) => browser.runtime.getURL(path as '/selection-runtime.js'),
            importModule: (url) => import(/* @vite-ignore */ url),
          }),
        runtime: {
          getConfig,
          watchConfig: watchData,
          listEngines,
          detectLanguage: (text) => browser.i18n.detectLanguage(text),
        },
        read: () => readSelection(document),
        hasFocus: () => document.hasFocus(),
        // `runtime.id` is unset once the extension is updated or reloaded.
        alive: () => browser.runtime?.id !== undefined,
        onContextLost: () => {
          selectionWatch.stop();
          holdWatch.stop();
        },
      },
    });

    const selectionWatch = createSelectionWatch({
      doc: document,
      getConfig,
      watchConfig: watchData,
      onCandidate: (selection) => bootstrap.showDot(selection),
      onClear: () => bootstrap.hideDot(),
    });
    selectionWatch.start();

    // Holding Ctrl (or the key set in `page.holdKey`) over a paragraph toggles it; with no
    // page session, it translates the held paragraphs alone (the page runtime loads on the
    // first hold).
    const holdWatch = createHoldWatch({
      doc: document,
      onHold: (point) => bootstrap.holdToggle(point),
      getConfig,
      watchConfig: watchData,
    });
    holdWatch.start();

    startIfRemembered({
      origin: location.origin,
      readMemory: async () => (await browser.storage.local.get(SITE_MEMORY_KEY))[SITE_MEMORY_KEY],
      start: () => bootstrap.autoStart(),
    }).catch(() => {
      // Storage unavailable, extension reloaded or runtime failed to load: stay untouched.
    });
  },
});
