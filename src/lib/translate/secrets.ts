import { isPlainObject } from '@/lib/config/merge';
import type { KeyValueStore } from '@/lib/config/repository';
import { type AppError, appError } from '@/lib/errors';

export const SECRETS_STORAGE_KEY = 'secrets';

export const SECRET_PROVIDERS = ['openai', 'deepseek', 'gemini', 'custom'] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export interface SecretStatus {
  configured: boolean;
  last4: string;
}

// Zero-width and bidi marks, line/paragraph separators, BOM and control characters.
// Pasted keys most often carry a stray newline.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF]/;

export function invalidSecretError(): AppError {
  return appError(
    'validation',
    'validation/invalid-secret',
    'API key contains invisible characters',
  );
}

/** Trims; rejects invisible characters. Never echoes the value. */
export function cleanApiKey(raw: string): string {
  const key = raw.trim();
  if (INVISIBLE.test(key)) throw invalidSecretError();
  return key;
}

function toStatus(key: string | undefined): SecretStatus {
  if (!key) return { configured: false, last4: '' };
  // Short values would be fully revealed by a suffix.
  return { configured: true, last4: key.length >= 8 ? key.slice(-4) : '' };
}

function readSecrets(raw: unknown): Partial<Record<SecretProvider, string>> {
  if (!isPlainObject(raw)) return {};
  const secrets: Partial<Record<SecretProvider, string>> = {};
  for (const provider of SECRET_PROVIDERS) {
    const value = raw[provider];
    if (typeof value === 'string' && value !== '') secrets[provider] = value;
  }
  return secrets;
}

export interface SecretStore {
  /** Background only. */
  get(provider: SecretProvider): Promise<string | undefined>;
  /** Overwrite semantics, so a retry after a lost reply is safe. `null` (or blank) deletes. */
  set(provider: SecretProvider, key: string | null): Promise<SecretStatus>;
  status(): Promise<Record<SecretProvider, SecretStatus>>;
}

export function createSecretStore(store: KeyValueStore): SecretStore {
  // Read-modify-write on one object: serialize writers.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    async get(provider) {
      return readSecrets(await store.get(SECRETS_STORAGE_KEY))[provider];
    },

    set(provider, key) {
      return enqueue(async () => {
        const cleaned = key === null ? '' : cleanApiKey(key);
        const secrets = readSecrets(await store.get(SECRETS_STORAGE_KEY));
        if (cleaned === '') delete secrets[provider];
        else secrets[provider] = cleaned;
        await store.set(SECRETS_STORAGE_KEY, secrets);
        return toStatus(secrets[provider]);
      });
    },

    async status() {
      const secrets = readSecrets(await store.get(SECRETS_STORAGE_KEY));
      return Object.fromEntries(
        SECRET_PROVIDERS.map((provider) => [provider, toStatus(secrets[provider])]),
      ) as Record<SecretProvider, SecretStatus>;
    },
  };
}
