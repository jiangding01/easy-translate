import { storage } from 'wxt/utils/storage';
import type { KeyValueStore } from './repository';

/** Production KeyValueStore backed by `chrome.storage.local`. */
export function createLocalStore(): KeyValueStore {
  return {
    get: (key) => storage.getItem(`local:${key}`),
    set: (key, value) => storage.setItem(`local:${key}`, value),
  };
}
