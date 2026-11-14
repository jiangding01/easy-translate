import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '@/lib/config/repository';
import {
  createSiteMemoryStore,
  isSiteOrigin,
  readSiteMemory,
  SITE_MEMORY_KEY,
  siteEntry,
} from './site-memory';

function memory() {
  const data = new Map<string, unknown>();
  const store: KeyValueStore & { data: Map<string, unknown> } = {
    data,
    async get(key) {
      return structuredClone(data.get(key));
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
  return store;
}

describe('isSiteOrigin', () => {
  it.each(['https://example.com', 'http://localhost:8080', 'https://a.b.example.org'])(
    'accepts %s',
    (origin) => expect(isSiteOrigin(origin)).toBe(true),
  );

  it.each([
    '',
    '__proto__',
    'constructor',
    'https://example.com/',
    'https://example.com/path',
    'chrome://extensions',
    'file:///tmp/a.html',
    'javascript:alert(1)',
    42,
  ])('rejects %j', (origin) => expect(isSiteOrigin(origin)).toBe(false));
});

describe('readSiteMemory', () => {
  it('keeps well-formed own entries only', () => {
    const raw = JSON.parse(
      '{"https://a.com":{"always":true},"__proto__":{"always":true},"bad":{"always":true},"https://b.com":{"always":"yes"}}',
    );
    const read = readSiteMemory(raw);
    expect(read).toEqual({ 'https://a.com': { always: true } });
    expect(siteEntry(read, 'constructor')).toBeUndefined();
    expect(readSiteMemory('garbage')).toEqual({});
  });
});

describe('createSiteMemoryStore', () => {
  it('adds and removes entries, serializing concurrent writes', async () => {
    const backing = memory();
    const store = createSiteMemoryStore(backing);
    await Promise.all([
      store.setAlways('https://a.com', true),
      store.setAlways('https://b.com', true),
    ]);
    expect(backing.data.get(SITE_MEMORY_KEY)).toEqual({
      'https://a.com': { always: true },
      'https://b.com': { always: true },
    });
    expect(await store.setAlways('https://a.com', false)).toEqual({
      'https://b.com': { always: true },
    });
  });

  it('rejects malformed origins without writing', async () => {
    const backing = memory();
    const store = createSiteMemoryStore(backing);
    await expect(store.setAlways('__proto__', true)).rejects.toMatchObject({
      code: 'validation/invalid-payload',
    });
    expect(backing.data.has(SITE_MEMORY_KEY)).toBe(false);
  });
});
