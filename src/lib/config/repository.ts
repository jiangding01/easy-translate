import { appError, isAppError } from '@/lib/errors';
import { createDefaultConfig } from './defaults';
import { isPlainObject } from './merge';
import { parseStoredConfig } from './parse';
import { CONFIG_PATHS, getPath, isConfigPath, setPath } from './paths';
import { configSchema } from './schema';
import {
  CONFIG_SCHEMA_VERSION,
  CONFIG_STORAGE_KEY,
  type ConfigChange,
  type ConfigPath,
  type ConfigSnapshot,
  type ConfigV1,
  type CustomProviderChange,
  isBuiltinEngine,
  isCustomProviderId,
  MAX_CUSTOM_PROVIDERS,
} from './types';

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface ConfigRepositoryDeps {
  store: KeyValueStore;
  uiLanguage: string;
}

export interface ConfigRepository {
  /** Reads and leniently parses; writes the repaired value back once if needed. */
  load(): Promise<ConfigSnapshot>;
  patch(changes: readonly ConfigChange[]): Promise<ConfigSnapshot>;
  /** Resets the given paths, or every known path, to defaults. Unknown keys survive. */
  reset(paths?: readonly ConfigPath[]): Promise<ConfigSnapshot>;
}

/**
 * The single writer of `storage.local["config"]` (background only). Every
 * operation that may write runs on one promise chain, so a load repair and a
 * patch that arrive together (SW woken by the patch) cannot overwrite each
 * other. Broadcasting is left entirely to `storage.onChanged`.
 * Failures reject with an AppError and leave the store untouched.
 */
export function createConfigRepository(deps: ConfigRepositoryDeps): ConfigRepository {
  const { store, uiLanguage } = deps;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function read() {
    let raw: unknown;
    try {
      raw = await store.get(CONFIG_STORAGE_KEY);
    } catch (error) {
      throw appError('config', 'config/read-failed', describe(error), { retryable: true });
    }
    return parseStoredConfig(raw, { uiLanguage, schema: configSchema });
  }

  async function write(data: unknown): Promise<ConfigSnapshot> {
    const parsed = configSchema.safeParse(data);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.'));
      throw appError('config', 'config/invalid-value', `Invalid config at: ${paths.join(', ')}`);
    }
    const snapshot: ConfigSnapshot = {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      data: parsed.data as ConfigV1,
    };
    try {
      await store.set(CONFIG_STORAGE_KEY, snapshot);
    } catch (error) {
      throw appError('config', 'config/write-failed', describe(error), { retryable: true });
    }
    return snapshot;
  }

  async function readWritable() {
    const current = await read();
    if (current.readOnly) {
      throw appError(
        'config',
        'config/newer-version',
        'Config was written by a newer version; refusing to overwrite it',
      );
    }
    return current.snapshot.data;
  }

  return {
    load: () =>
      enqueue(async () => {
        const current = await read();
        if (current.repaired && !current.readOnly) {
          try {
            await store.set(CONFIG_STORAGE_KEY, current.snapshot);
          } catch {
            // The repaired snapshot is still valid in memory; the next write persists it.
            console.warn('[config] failed to write back the repaired config');
          }
        }
        return current.snapshot;
      }),

    patch: (changes) =>
      enqueue(async () => {
        let data: unknown = await readWritable();
        for (const change of changes) {
          if (isCustomProviderChange(change)) {
            data = applyCustomProviderChange(data, change);
            continue;
          }
          // The record itself is never replaced wholesale through a patch.
          if (!isConfigPath(change.path) || (change.path as string) === 'customProviders') {
            throw appError('config', 'config/unknown-path', `Unknown config path: ${change.path}`);
          }
          data = setPath(data, change.path, change.value);
        }
        return write(dropDanglingEngine(data));
      }),

    reset: (paths) =>
      enqueue(async () => {
        let data: unknown = await readWritable();
        const defaults = createDefaultConfig(uiLanguage);
        for (const path of paths ?? (CONFIG_PATHS as readonly ConfigPath[])) {
          if (!isConfigPath(path)) {
            throw appError('config', 'config/unknown-path', `Unknown config path: ${path}`);
          }
          data = setPath(data, path, structuredClone(getPath(defaults, path)));
        }
        return write(data);
      }),
  };
}

function isCustomProviderChange(change: ConfigChange): change is CustomProviderChange {
  return change.path === 'customProviders' && 'key' in change;
}

function applyCustomProviderChange(data: unknown, change: CustomProviderChange): unknown {
  if (!isCustomProviderId(change.key)) {
    throw appError('config', 'config/invalid-value', 'Invalid custom provider id');
  }
  const current = getPath(data, 'customProviders');
  const providers: Record<string, unknown> = isPlainObject(current) ? { ...current } : {};
  if (change.value === null) {
    delete providers[change.key];
  } else {
    if (
      !Object.hasOwn(providers, change.key) &&
      Object.keys(providers).length >= MAX_CUSTOM_PROVIDERS
    ) {
      throw appError(
        'config',
        'config/provider-limit',
        `At most ${MAX_CUSTOM_PROVIDERS} custom providers`,
      );
    }
    // Replacing an existing key keeps its position, so display order is stable.
    providers[change.key] = structuredClone(change.value);
  }
  return setPath(data, 'customProviders', providers);
}

/** Removing the default provider falls back to Google in the same write. */
function dropDanglingEngine(data: unknown): unknown {
  const engine = getPath(data, 'translation.engine');
  const providers = getPath(data, 'customProviders');
  if (isBuiltinEngine(engine)) return data;
  if (isCustomProviderId(engine) && isPlainObject(providers) && Object.hasOwn(providers, engine)) {
    return data;
  }
  return isCustomProviderId(engine) ? setPath(data, 'translation.engine', 'google') : data;
}

function describe(error: unknown): string {
  if (isAppError(error) || error instanceof Error) return error.message;
  return 'Unknown storage error';
}
