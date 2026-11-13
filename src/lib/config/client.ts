import { storage } from 'wxt/utils/storage';
import type { Result } from '@/lib/errors';
import { browserUiLanguage, isLanguageCode } from '@/lib/languages';
import { call } from '@/lib/messaging/handle';
import { sendMessage } from '@/lib/messaging/protocol';
import { createDefaultSnapshot } from './defaults';
import { isPlainObject, mergeDefaults } from './merge';
import {
  CONFIG_SCHEMA_VERSION,
  CONFIG_STORAGE_KEY,
  type ConfigChange,
  type ConfigPath,
  type ConfigSnapshot,
  THEMES,
  type Theme,
} from './types';

// Config access for extension pages and content scripts. Deliberately zod-free:
// the background is the only writer and validates everything it stores, so
// this layer only guards against version skew.

const STORAGE_ITEM = `local:${CONFIG_STORAGE_KEY}` as const;

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Structural merge with defaults plus enum guards. Pure; exported for tests. */
export function normalizeConfig(raw: unknown, uiLanguage: string): ConfigSnapshot {
  const defaults = createDefaultSnapshot(uiLanguage);
  if (!isPlainObject(raw) || raw.schemaVersion !== CONFIG_SCHEMA_VERSION) return defaults;

  const merged = mergeDefaults(defaults.data, raw.data);
  if (!isPlainObject(merged)) return defaults;
  const ui = isPlainObject(merged.ui) ? merged.ui : {};
  const language = isPlainObject(merged.language) ? merged.language : {};
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    data: {
      ...merged,
      ui: { ...ui, theme: isTheme(ui.theme) ? ui.theme : defaults.data.ui.theme },
      language: {
        ...language,
        target: isLanguageCode(language.target) ? language.target : defaults.data.language.target,
      },
    },
  };
}

export async function readConfig(): Promise<ConfigSnapshot> {
  const raw = await storage.getItem<unknown>(STORAGE_ITEM);
  return normalizeConfig(raw, browserUiLanguage());
}

/** Calls `callback` whenever the stored config changes; returns the unsubscribe function. */
export function watchConfig(callback: (snapshot: ConfigSnapshot) => void): () => void {
  return storage.watch<unknown>(STORAGE_ITEM, (value) => {
    callback(normalizeConfig(value, browserUiLanguage()));
  });
}

export function patchConfig(changes: ConfigChange[]): Promise<Result<ConfigSnapshot>> {
  return call(() => sendMessage('config.patch', changes));
}

export function resetConfig(paths?: ConfigPath[]): Promise<Result<ConfigSnapshot>> {
  return call(() => sendMessage('config.reset', paths));
}
