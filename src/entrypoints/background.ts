import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { GET_BACKGROUND_STATUS, isMessage } from '@/lib/messages';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isMessage(message, GET_BACKGROUND_STATUS)) {
      sendResponse({ version: browser.runtime.getManifest().version });
    }
  });
});
