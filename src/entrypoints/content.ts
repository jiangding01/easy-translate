import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { sampleText, startIfRemembered } from '@/content/auto-start';
import { createBootstrap } from '@/content/bootstrap';
import { loadPageRuntime } from '@/content/loader';
import { readConfig, watchConfig } from '@/lib/config/client';
import { onMessage, sendMessage } from '@/lib/messaging/protocol';
import { SITE_MEMORY_KEY } from '@/lib/site-memory';

// Runs on every page but leaves no trace until invoked: no Port, no observers,
// no DOM writes. The page runtime (session, scanner, renderer) is a separate
// file imported on first use; this entry only routes messages (content/bootstrap).

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  // WXT otherwise window.postMessage()s `${runtime.id}:...content-script-started` to the
  // page on every load, handing any site the extension ID. It only serves extensions
  // whose older builds listened for that message; ours never did.
  noScriptStartedPostMessage: true,
  main() {
    const getConfig = async () => (await readConfig()).data;
    const bootstrap = createBootstrap({
      onMessage,
      pageInfo: () => ({
        title: document.title,
        language: document.documentElement.lang,
      }),
      loadFactory: () =>
        loadPageRuntime({
          getURL: (path) => browser.runtime.getURL(path as '/page-runtime.js'),
          importModule: (url) => import(/* @vite-ignore */ url),
        }),
      runtime: {
        getConfig,
        watchConfig: (callback) => watchConfig((snapshot) => callback(snapshot.data)),
        reportStatus: (status) => {
          sendMessage('page.status', status).catch(() => {
            // Background unreachable or extension reloaded: the dot is cosmetic.
          });
        },
      },
    });

    startIfRemembered({
      origin: location.origin,
      readMemory: async () => (await browser.storage.local.get(SITE_MEMORY_KEY))[SITE_MEMORY_KEY],
      getConfig,
      declared: document.documentElement.lang,
      sample: () => sampleText(document.body),
      detect: (text) => browser.i18n.detectLanguage(text),
      start: () => bootstrap.startIfIdle(),
    }).catch(() => {
      // Storage unavailable, extension reloaded or runtime failed to load: stay untouched.
    });
  },
});
