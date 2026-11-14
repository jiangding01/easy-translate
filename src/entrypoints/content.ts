import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { pageIsInLanguage, sampleText } from '@/content/auto-start';
import { createStyleReader } from '@/content/dom-rules';
import { createPageSession, type PageSession } from '@/content/session';
import { createIntersectionViewport } from '@/content/viewport';
import { readConfig } from '@/lib/config/client';
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
import { readSiteMemory, SITE_MEMORY_KEY, siteEntry } from '@/lib/site-memory';

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
    onMessage(
      'page.start',
      handle(({ data }) => ensure().start(data ?? {})),
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

    void autoStart().catch(() => {
      // Storage unavailable or extension reloaded: stay untouched.
    });

    async function autoStart() {
      const stored = await browser.storage.local.get(SITE_MEMORY_KEY);
      const entry = siteEntry(readSiteMemory(stored[SITE_MEMORY_KEY]), location.origin);
      if (!entry?.always) return;
      const { data: config } = await readConfig();
      const native = await pageIsInLanguage(config.language.target, {
        declared: document.documentElement.lang,
        sample: () => sampleText(document.body),
        detect: (text) => browser.i18n.detectLanguage(text),
      });
      if (!native && ensure().state().phase === 'idle') await ensure().start();
    }
  },
});
