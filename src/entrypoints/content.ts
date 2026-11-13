import { defineContentScript } from 'wxt/utils/define-content-script';
import { handle } from '@/lib/messaging/handle';
import { onMessage } from '@/lib/messaging/protocol';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    onMessage(
      'page.getInfo',
      handle(() => ({
        title: document.title,
        language: document.documentElement.lang,
      })),
    );
  },
});
