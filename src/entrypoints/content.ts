import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { sampleText, startIfRemembered } from '@/content/auto-start';
import { createStyleReader } from '@/content/dom-rules';
import { createPageSession, type PageSession } from '@/content/session';
import { createIntersectionViewport } from '@/content/viewport';
import { readConfig, watchConfig } from '@/lib/config/client';
import { handle } from '@/lib/messaging/handle';
import { createPortClient } from '@/lib/messaging/port';
import {
  onMessage,
  sendMessage,
  TRANSLATE_PORT_NAME,
  type TranslateChunk,
  type TranslateDone,
  type TranslateRequest,
} from '@/lib/messaging/protocol';
import { SITE_MEMORY_KEY } from '@/lib/site-memory';

// Runs on every page but leaves no trace until invoked: no Port, no observers,
// no DOM writes. The session (and its Port) is created on first use.

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    let session: PageSession | undefined;
    const ensure = (): PageSession => {
      session ??= createPageSession({
        win: window,
        port: createPortClient<TranslateRequest, TranslateChunk, TranslateDone>(() =>
          browser.runtime.connect({ name: TRANSLATE_PORT_NAME }),
        ),
        getConfig: async () => (await readConfig()).data,
        watchConfig: (callback) => watchConfig((snapshot) => callback(snapshot.data)),
        reportStatus: (status) => {
          sendMessage('page.status', status).catch(() => {
            // Background unreachable or extension reloaded: the dot is cosmetic.
          });
        },
        createReadStyle: () => createStyleReader(window),
        createViewport: createIntersectionViewport,
      });
      return session;
    };

    onMessage(
      'page.getInfo',
      handle(() => ({
        title: document.title,
        language: document.documentElement.lang,
      })),
    );
    onMessage(
      'page.getState',
      handle(() => ensure().state()),
    );
    // Answers as soon as the session is running, so the panel can close at once;
    // discovery continues in the page.
    onMessage(
      'page.start',
      handle(({ data }) => {
        const session = ensure();
        session.start(data ?? {}).catch(() => {
          // A failed start already restored the page; the panel shows idle next time.
        });
        return session.state();
      }),
    );
    onMessage(
      'page.stop',
      handle(() => ensure().stop()),
    );
    onMessage(
      'page.toggle',
      handle(() => ensure().toggle()),
    );
    onMessage(
      'page.setMode',
      handle(({ data }) => ensure().setMode(data)),
    );
    onMessage(
      'page.retryFailed',
      handle(() => ensure().retryFailed()),
    );

    startIfRemembered({
      origin: location.origin,
      readMemory: async () => (await browser.storage.local.get(SITE_MEMORY_KEY))[SITE_MEMORY_KEY],
      getConfig: async () => (await readConfig()).data,
      declared: document.documentElement.lang,
      sample: () => sampleText(document.body),
      detect: (text) => browser.i18n.detectLanguage(text),
      start: () => (ensure().state().phase === 'idle' ? ensure().start() : Promise.resolve()),
    }).catch(() => {
      // Storage unavailable or extension reloaded: stay untouched.
    });
  },
});
