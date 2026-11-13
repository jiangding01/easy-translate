import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createLocalStore } from '@/lib/config/local-store';
import { createConfigRepository } from '@/lib/config/repository';
import { toAppError } from '@/lib/errors';
import { handle } from '@/lib/messaging/handle';
import { onMessage } from '@/lib/messaging/protocol';

export default defineBackground(() => {
  const repo = createConfigRepository({
    store: createLocalStore(),
    uiLanguage: browser.i18n.getUILanguage(),
  });

  // Register synchronously at top level so a message that wakes the SW is handled.
  onMessage(
    'app.getStatus',
    handle(() => ({ version: browser.runtime.getManifest().version })),
  );
  onMessage(
    'config.patch',
    handle(({ data }) => repo.patch(data)),
  );
  onMessage(
    'config.reset',
    handle(({ data }) => repo.reset(data)),
  );

  const load = () => {
    // Shares the repository queue with patches, so it never races them.
    repo.load().catch((error: unknown) => {
      console.warn('[config] load failed:', toAppError(error).code);
    });
  };
  browser.runtime.onInstalled.addListener(load);
  load();
});
