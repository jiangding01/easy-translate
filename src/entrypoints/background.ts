import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createLocalStore } from '@/lib/config/local-store';
import { createConfigRepository } from '@/lib/config/repository';
import { toAppError } from '@/lib/errors';
import { handle } from '@/lib/messaging/handle';
import { onMessage, TRANSLATE_PORT_NAME } from '@/lib/messaging/protocol';
import { createAdminHandlers } from '@/lib/translate/admin';
import { createTranslationCache } from '@/lib/translate/cache';
import { createTranslatePortHost } from '@/lib/translate/port-host';
import { createSecretStore } from '@/lib/translate/secrets';
import { createTranslateService } from '@/lib/translate/service';

export default defineBackground(() => {
  const store = createLocalStore();
  const repo = createConfigRepository({ store, uiLanguage: browser.i18n.getUILanguage() });
  const secrets = createSecretStore(store);
  const cache = createTranslationCache();
  const service = createTranslateService({
    getConfig: async () => (await repo.load()).data,
    secrets,
    cache,
  });
  const admin = createAdminHandlers({
    getConfig: async () => (await repo.load()).data,
    secrets,
    cache,
    scheduler: service.scheduler,
    optionsUrl: browser.runtime.getURL('/options.html'),
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
  onMessage('secrets.set', ({ data, sender }) => admin['secrets.set'](sender, data));
  onMessage('secrets.status', ({ sender }) => admin['secrets.status'](sender));
  onMessage('provider.test', ({ data, sender }) => admin['provider.test'](sender, data));
  onMessage('cache.stats', ({ sender }) => admin['cache.stats'](sender));
  onMessage('cache.clear', ({ sender }) => admin['cache.clear'](sender));
  browser.runtime.onConnect.addListener(createTranslatePortHost(service, TRANSLATE_PORT_NAME));

  const load = () => {
    // Shares the repository queue with patches, so it never races them.
    repo.load().catch((error: unknown) => {
      console.warn('[config] load failed:', toAppError(error).code);
    });
  };
  browser.runtime.onInstalled.addListener(load);
  load();
});
