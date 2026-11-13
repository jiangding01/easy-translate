import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '@/lib/config/repository';
import { cleanApiKey, createSecretStore } from './secrets';

function memory(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      await Promise.resolve();
      return structuredClone(data.get(key));
    },
    async set(key, value) {
      await Promise.resolve();
      data.set(key, structuredClone(value));
    },
  };
}

describe('secret store', () => {
  it('writes, reads and deletes', async () => {
    const store = createSecretStore(memory());
    await store.set('openai', 'sk-abcdef1234');
    expect(await store.get('openai')).toBe('sk-abcdef1234');
    expect(await store.get('gemini')).toBeUndefined();
    expect(await store.set('openai', null)).toEqual({ configured: false, last4: '' });
    expect(await store.get('openai')).toBeUndefined();
  });

  it('status exposes only the last four characters', async () => {
    const backing = memory();
    const store = createSecretStore(backing);
    await store.set('deepseek', 'sk-abcdef1234');
    const status = await store.status();
    expect(status.deepseek).toEqual({ configured: true, last4: '1234' });
    expect(status.openai).toEqual({ configured: false, last4: '' });
    expect(JSON.stringify(status)).not.toContain('abcdef');
  });

  it('does not reveal short keys through last4', async () => {
    const store = createSecretStore(memory());
    expect(await store.set('custom', 'abc123')).toEqual({ configured: true, last4: '' });
  });

  it('is idempotent', async () => {
    const backing = memory();
    const store = createSecretStore(backing);
    await store.set('openai', 'sk-abcdef1234');
    const first = structuredClone(backing.data.get('secrets'));
    await store.set('openai', 'sk-abcdef1234');
    expect(backing.data.get('secrets')).toEqual(first);
  });

  it('trims surrounding whitespace', async () => {
    const store = createSecretStore(memory());
    await store.set('openai', '  sk-abcdef1234\n');
    expect(await store.get('openai')).toBe('sk-abcdef1234');
  });

  it.each(['sk-abc\ndef', 'sk-abc​def', 'sk-abc\u0000def', 'sk-abc﻿def', 'sk-\tabc'])(
    'rejects invisible characters (%j) and keeps the old value',
    async (bad) => {
      const store = createSecretStore(memory());
      await store.set('openai', 'sk-good-1234');
      await expect(store.set('openai', bad)).rejects.toMatchObject({
        code: 'validation/invalid-secret',
      });
      expect(await store.get('openai')).toBe('sk-good-1234');
    },
  );

  it('does not put the key in the error', () => {
    try {
      cleanApiKey('sk-secret​');
      expect.unreachable();
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('sk-secret');
    }
  });

  it('keeps concurrent writes to different providers', async () => {
    const store = createSecretStore(memory());
    await Promise.all([store.set('openai', 'sk-aaaaaaaa'), store.set('gemini', 'sk-bbbbbbbb')]);
    expect(await store.get('openai')).toBe('sk-aaaaaaaa');
    expect(await store.get('gemini')).toBe('sk-bbbbbbbb');
  });

  it('ignores a corrupted stored value', async () => {
    const backing = memory();
    backing.data.set('secrets', 'garbage');
    const store = createSecretStore(backing);
    expect((await store.status()).openai.configured).toBe(false);
  });
});
