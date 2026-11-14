import { isPlainObject } from '@/lib/config/merge';
import type { KeyValueStore } from '@/lib/config/repository';
import { appError } from '@/lib/errors';

// Per-site memory ("总是翻译此站"), stored apart from the config. The background is
// the only writer; content scripts read it directly. Pure apart from the store.

export const SITE_MEMORY_KEY = 'siteMemory';

export interface SiteEntry {
  always: boolean;
}

/** Keyed by origin (`https://example.com`). */
export type SiteMemory = Record<string, SiteEntry>;

/** An http(s) origin and nothing more: no path, no `__proto__`, no empty string. */
export function isSiteOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

/** Keeps well-formed entries only; never trusts the stored shape. */
export function readSiteMemory(raw: unknown): SiteMemory {
  const memory: SiteMemory = {};
  if (!isPlainObject(raw)) return memory;
  for (const [origin, entry] of Object.entries(raw)) {
    if (isSiteOrigin(origin) && isPlainObject(entry) && typeof entry.always === 'boolean') {
      memory[origin] = { always: entry.always };
    }
  }
  return memory;
}

export function siteEntry(memory: SiteMemory, origin: string): SiteEntry | undefined {
  return Object.hasOwn(memory, origin) ? memory[origin] : undefined;
}

export interface SiteMemoryStore {
  /** Overwrite semantics; turning a site off removes its entry. */
  setAlways(origin: string, always: boolean): Promise<SiteMemory>;
}

/** Background only. Writes are serialized (read-modify-write on one key). */
export function createSiteMemoryStore(store: KeyValueStore): SiteMemoryStore {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    setAlways(origin, always) {
      return enqueue(async () => {
        if (!isSiteOrigin(origin) || typeof always !== 'boolean') {
          throw appError('validation', 'validation/invalid-payload', 'Invalid site origin');
        }
        const memory = readSiteMemory(await store.get(SITE_MEMORY_KEY));
        if (always) memory[origin] = { always: true };
        else delete memory[origin];
        await store.set(SITE_MEMORY_KEY, memory);
        return memory;
      });
    },
  };
}
