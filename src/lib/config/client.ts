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
  type ConfigV1,
  CUSTOM_PROVIDER_ID_PATTERN,
  type CustomProvider,
  isBuiltinEngine,
  isCustomProviderId,
  PAGE_MODES,
  PAGE_STYLES,
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

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return (values as readonly unknown[]).includes(value) ? (value as T) : undefined;
}

function isCustomProvider(value: unknown): value is CustomProvider {
  return (
    isPlainObject(value) &&
    typeof value.name === 'string' &&
    typeof value.baseURL === 'string' &&
    typeof value.model === 'string'
  );
}

/** Keeps well-formed entries in stored order. */
function normalizeCustomProviders(raw: unknown): Record<string, CustomProvider> {
  const providers: Record<string, CustomProvider> = {};
  if (!isPlainObject(raw)) return providers;
  for (const [id, value] of Object.entries(raw)) {
    if (CUSTOM_PROVIDER_ID_PATTERN.test(id) && isCustomProvider(value)) providers[id] = value;
  }
  return providers;
}

/** Structural merge with defaults plus enum guards. Pure; exported for tests. */
export function normalizeConfig(raw: unknown, uiLanguage: string): ConfigSnapshot {
  const defaults = createDefaultSnapshot(uiLanguage);
  if (!isPlainObject(raw) || raw.schemaVersion !== CONFIG_SCHEMA_VERSION) return defaults;

  const merged = mergeDefaults(defaults.data, raw.data);
  if (!isPlainObject(merged)) return defaults;
  const ui = isPlainObject(merged.ui) ? merged.ui : {};
  const language = isPlainObject(merged.language) ? merged.language : {};
  const translation = isPlainObject(merged.translation) ? merged.translation : {};
  const page = isPlainObject(merged.page) ? merged.page : {};
  const customProviders = normalizeCustomProviders(merged.customProviders);
  const engine = translation.engine;
  const engineOk =
    isBuiltinEngine(engine) ||
    (isCustomProviderId(engine) && Object.hasOwn(customProviders, engine));
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    data: {
      ...merged,
      ui: { ...ui, theme: isTheme(ui.theme) ? ui.theme : defaults.data.ui.theme },
      language: {
        ...language,
        target: isLanguageCode(language.target) ? language.target : defaults.data.language.target,
        source:
          language.source === 'auto' || isLanguageCode(language.source)
            ? language.source
            : defaults.data.language.source,
      },
      providers: merged.providers as ConfigV1['providers'],
      customProviders,
      page: {
        ...page,
        style: oneOf(PAGE_STYLES, page.style) ?? defaults.data.page.style,
        mode: oneOf(PAGE_MODES, page.mode) ?? defaults.data.page.mode,
      },
      translation: {
        ...translation,
        engine: engineOk ? engine : defaults.data.translation.engine,
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
