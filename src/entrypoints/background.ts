import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createLocalStore } from '@/lib/config/local-store';
import { createConfigRepository } from '@/lib/config/repository';
import { CONFIG_STORAGE_KEY, type ConfigSnapshot } from '@/lib/config/types';
import { toAppError } from '@/lib/errors';
import { handle } from '@/lib/messaging/handle';
import { onMessage, TRANSLATE_PORT_NAME } from '@/lib/messaging/protocol';
import { createConfigHandlers } from '@/lib/messaging/sender';
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
  const config = createConfigHandlers({ repo, extensionRoot: browser.runtime.getURL('/') });
  const admin = createAdminHandlers({
    getConfig: async () => (await repo.load()).data,
    secrets,
    cache,
    scheduler: service.scheduler,
    optionsUrl: browser.runtime.getURL('/options.html'),
    popupUrl: browser.runtime.getURL('/popup.html'),
  });

  // Register synchronously at top level so a message that wakes the SW is handled.
  onMessage(
    'app.getStatus',
    handle(() => ({ version: browser.runtime.getManifest().version })),
  );
  // Config writes are accepted from extension pages only, never from content scripts.
  onMessage('config.patch', ({ data, sender }) => config['config.patch'](sender, data));
  onMessage('config.reset', ({ data, sender }) => config['config.reset'](sender, data));
  onMessage('secrets.set', ({ data, sender }) => admin['secrets.set'](sender, data));
  onMessage('secrets.status', ({ sender }) => admin['secrets.status'](sender));
  onMessage('provider.test', ({ data, sender }) => admin['provider.test'](sender, data));
  onMessage('cache.stats', ({ sender }) => admin['cache.stats'](sender));
  onMessage('cache.clear', ({ sender }) => admin['cache.clear'](sender));
  browser.runtime.onConnect.addListener(createTranslatePortHost(service, TRANSLATE_PORT_NAME));

  // A key lives exactly as long as its custom provider, however the provider went
  // away (deleted on any page, reset, dropped by repair). The background owns this.
  // A config written by a newer build is read-only here: its defaults stand in for
  // providers that still exist, so it must never decide which keys to delete.
  const pruneSecrets = (snapshot: ConfigSnapshot | undefined) => {
    if (!snapshot) return;
    secrets.pruneCustom(new Set(Object.keys(snapshot.data.customProviders))).catch(() => {
      console.warn('[secrets] prune failed');
    });
  };
  const load = () => {
    // Shares the repository queue with patches, so it never races them.
    repo
      .loadStored()
      .then(pruneSecrets)
      .catch((error: unknown) => {
        console.warn('[config] load failed:', toAppError(error).code);
      });
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && CONFIG_STORAGE_KEY in changes) load();
  });
  browser.runtime.onInstalled.addListener(load);
  load();
});
