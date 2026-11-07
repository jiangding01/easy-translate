import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { GET_PAGE_INFO, isMessage, type PageInfo } from '@/lib/messages';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isMessage(message, GET_PAGE_INFO)) {
        const info: PageInfo = {
          title: document.title,
          language: document.documentElement.lang || '未声明',
        };
        sendResponse(info);
      }
    });
  },
});
