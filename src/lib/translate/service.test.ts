import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '@/lib/config/defaults';
import type { ConfigV1 } from '@/lib/config/types';
import { appError, fail, ok } from '@/lib/errors';
import { createPortClient, type PortLike, servePort } from '@/lib/messaging/port';
import type { TranslateChunk, TranslateDone, TranslateRequest } from '@/lib/messaging/protocol';
import { createTranslationCache, openCacheDb } from './cache';
import type { DetectLanguage } from './language';
import { checkEngineEndpoint } from './permissions';
import {
  classifyTranslation,
  createTranslateService,
  parseTranslateRequest,
  preprocessText,
  type TranslateServiceDeps,
} from './service';
import { jsonResponse, sseResponse } from './test-utils';

// ------------------------------------------------------------ in-memory port

type Listener<T extends unknown[]> = (...args: T) => void;

function endpoint() {
  const messageListeners: Listener<[unknown]>[] = [];
  const disconnectListeners: Listener<[]>[] = [];
  return {
    messageListeners,
    disconnectListeners,
    onMessage: { addListener: (cb: Listener<[unknown]>) => void messageListeners.push(cb) },
    onDisconnect: { addListener: (cb: Listener<[]>) => void disconnectListeners.push(cb) },
  };
}

/** Chrome-like pair: structured-cloned async delivery, throws after disconnect. */
function createPortPair() {
  let connected = true;
  const a = endpoint();
  const b = endpoint();
  const side = (self: typeof a, other: typeof a): PortLike => ({
    onMessage: self.onMessage,
    onDisconnect: self.onDisconnect,
    postMessage(message) {
      if (!connected) throw new Error('Attempting to use a disconnected port object');
      const copy = structuredClone(message);
      queueMicrotask(() => {
        if (connected) for (const listener of other.messageListeners) listener(copy);
      });
    },
    disconnect() {
      if (!connected) return;
      connected = false;
      queueMicrotask(() => {
        for (const listener of other.disconnectListeners) listener();
      });
    },
  });
  return {
    client: side(a, b),
    server: side(b, a),
    /** Connection lost: both ends see onDisconnect. */
    breakConnection() {
      connected = false;
      for (const listener of [...a.disconnectListeners, ...b.disconnectListeners]) listener();
    },
  };
}

// ------------------------------------------------------------ fake providers

interface FetchCall {
  url: string;
  method: string;
  signal: AbortSignal;
  aborted: boolean;
}

type Handler = (texts: string[], call: FetchCall) => Response | Promise<Response>;

const googleOk: Handler = (texts) => jsonResponse(texts.map((text) => [`G:${text}`, 'en']));
const singleOk: Handler = ([text]) => jsonResponse([[[`S:${text}`, text, null, null]]]);
const openaiDelta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const openaiReply = (items: { i: number; t: string }[]) =>
  sseResponse([openaiDelta(JSON.stringify(items)), 'data: [DONE]\n\n']);
const openaiOk: Handler = (texts) => openaiReply(texts.map((text, i) => ({ i, t: `O:${text}` })));

/** Never answers; rejects like real fetch once aborted. */
const hang: Handler = (_texts, call) =>
  new Promise<Response>((_, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (call.signal.aborted) onAbort();
    else call.signal.addEventListener('abort', onAbort, { once: true });
  });

function createProviders() {
  const calls: FetchCall[] = [];
  const handlers: { google: Handler; single: Handler; openai: Handler } = {
    google: googleOk,
    single: singleOk,
    openai: openaiOk,
  };
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const signal = init?.signal as AbortSignal;
    const call: FetchCall = { url, method: init?.method ?? 'GET', signal, aborted: false };
    signal.addEventListener('abort', () => {
      call.aborted = true;
    });
    calls.push(call);
    if (url.includes('/translate_a/t?')) {
      return handlers.google(new URLSearchParams(String(init?.body)).getAll('q'), call);
    }
    if (url.includes('/translate_a/single?')) {
      return handlers.single([new URL(url).searchParams.get('q') ?? ''], call);
    }
    if (url.endsWith('/chat/completions')) {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const content = body.messages[1]?.content ?? '';
      const items = JSON.parse(content.slice(content.indexOf('['))) as { i: number; t: string }[];
      return handlers.openai(
        items.map((item) => item.t),
        call,
      );
    }
    throw new TypeError(`unexpected fetch ${url}`);
  });
  return {
    fetch: fetchFn as unknown as typeof fetch,
    calls,
    handlers,
    aborts: () => calls.filter((call) => call.aborted).length,
  };
}

// ------------------------------------------------------------ harness

let dbSeq = 0;

function setup(overrides: Partial<TranslateServiceDeps> = {}) {
  const providers = createProviders();
  const config: ConfigV1 = createDefaultConfig('zh-CN');
  config.providers.openai.model = 'gpt-test';
  const cache = createTranslationCache({ open: () => openCacheDb(`service-${dbSeq++}`) });
  const detect = vi.fn<DetectLanguage>(async () => ({ isReliable: false, languages: [] }));
  const service = createTranslateService({
    getConfig: async () => structuredClone(config),
    secrets: { get: async (provider) => (provider === 'openai' ? 'sk-test-secret' : undefined) },
    cache,
    fetch: providers.fetch,
    random: () => 0,
    detectLanguage: detect,
    checkPermission: async () => ok(undefined),
    ...overrides,
  });
  const pairs: ReturnType<typeof createPortPair>[] = [];
  const client = createPortClient<TranslateRequest, TranslateChunk, TranslateDone>(() => {
    const pair = createPortPair();
    // One fairness group per port, as the background registers it.
    const caller = `port-${pairs.length}`;
    servePort<TranslateRequest, TranslateChunk, TranslateDone>(pair.server, (payload, ctx) =>
      service.translate(payload, { ...ctx, caller }),
    );
    pairs.push(pair);
    return pair.client;
  });

  function request(payload: TranslateRequest) {
    const chunks: TranslateChunk[] = [];
    const handle = client.request(payload, (chunk) => chunks.push(chunk));
    return { ...handle, chunks };
  }

  async function run(payload: TranslateRequest) {
    const handle = request(payload);
    const outcome = await handle.outcome;
    const byId = Object.fromEntries(handle.chunks.map((chunk) => [chunk.id, chunk]));
    return { outcome, chunks: handle.chunks, byId };
  }

  return { providers, config, cache, detect, service, client, pairs, request, run };
}

const items = (...texts: string[]) => texts.map((text, index) => ({ id: `i${index}`, text }));

/** Waits until the cache holds `count` entries (writes are fire-and-forget). */
async function cached(cache: ReturnType<typeof setup>['cache'], count: number) {
  await vi.waitFor(async () => expect((await cache.stats()).count).toBe(count));
}

/** Not faked by the tests (they fake setTimeout only), so it runs after pending promise jobs. */
const macrotask = (globalThis as unknown as { setImmediate(callback: () => void): void })
  .setImmediate;

async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => macrotask(resolve));
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------ unit helpers

describe('preprocessing and classification', () => {
  it('drops zero-width characters and trims', () => {
    expect(preprocessText('​ Hello‌ world‍﻿ ')).toBe('Hello world');
  });

  it('classifies translations equal after normalization as unchanged', () => {
    expect(classifyTranslation('GitHub  API', 'github api ')).toBe('unchanged');
    expect(classifyTranslation('Hello', '你好')).toBe('translated');
  });

  it('rejects malformed payloads', () => {
    expect(() => parseTranslateRequest({ items: 'x' })).toThrow(
      expect.objectContaining({ code: 'validation/invalid-payload' }),
    );
    expect(() => parseTranslateRequest({ items: [{ id: 1, text: 'a' }] })).toThrow(
      expect.objectContaining({ code: 'validation/invalid-payload' }),
    );
    expect(() => parseTranslateRequest({ items: [], target: 'xx' })).toThrow(
      expect.objectContaining({ code: 'validation/invalid-payload' }),
    );
  });
});

// ------------------------------------------------------------ integration

describe('translate service over the port', () => {
  it('runs req → chunk → done, then serves the second request from the cache', async () => {
    const { providers, cache, run } = setup();
    const first = await run({ items: items('Hello', 'World') });
    expect(first.outcome).toEqual({ status: 'done', data: { total: 2, failed: 0 } });
    expect(first.byId).toEqual({
      i0: { id: 'i0', text: 'G:Hello', disposition: 'translated', cached: false },
      i1: { id: 'i1', text: 'G:World', disposition: 'translated', cached: false },
    });
    expect(providers.calls).toHaveLength(1);
    expect(providers.calls[0]?.method).toBe('POST');

    await cached(cache, 2);
    const second = await run({ items: items('Hello', 'World') });
    expect(second.outcome).toEqual({ status: 'done', data: { total: 2, failed: 0 } });
    expect(second.chunks.every((chunk) => 'cached' in chunk && chunk.cached)).toBe(true);
    expect(providers.calls).toHaveLength(1);
  });

  it('skips items detected as already in the target language', async () => {
    const { providers, detect, run } = setup();
    detect.mockImplementation(async (text) =>
      /[一-鿿]/.test(text)
        ? { isReliable: true, languages: [{ language: 'zh', percentage: 99 }] }
        : { isReliable: true, languages: [{ language: 'en', percentage: 99 }] },
    );
    const result = await run({
      items: items('这是一段足够长的中文文本内容', 'This is long English text'),
    });
    expect(result.byId.i0).toEqual({
      id: 'i0',
      text: '这是一段足够长的中文文本内容',
      disposition: 'same-language',
      cached: false,
    });
    expect(result.byId.i1).toMatchObject({ disposition: 'translated', cached: false });
    expect(providers.calls).toHaveLength(1);
  });

  it('does not detect when the source language is explicit', async () => {
    const { detect, run } = setup();
    await run({ items: items('这是一段足够长的中文文本内容'), source: 'en' });
    expect(detect).not.toHaveBeenCalled();
  });

  it('splits an LLM batch whose item count does not match, down to single items', async () => {
    const { providers, config, run } = setup();
    config.translation.engine = 'openai';
    let first = true;
    providers.handlers.openai = (texts, call) => {
      if (first) {
        first = false;
        return openaiReply([{ i: 0, t: 'only one' }]);
      }
      return openaiOk(texts, call);
    };
    const result = await run({ items: items('one', 'two', 'three'), source: 'en' });
    expect(result.outcome).toEqual({ status: 'done', data: { total: 3, failed: 0 } });
    expect(Object.values(result.byId).map((chunk) => 'text' in chunk && chunk.text)).toEqual([
      'O:one',
      'O:two',
      'O:three',
    ]);
    expect(providers.calls).toHaveLength(3); // [one, two, three] → [one, two] + [three]
  });

  it('fails only the item that stays malformed after splitting', async () => {
    const { providers, config, cache, run } = setup();
    config.translation.engine = 'openai';
    providers.handlers.openai = (texts) =>
      texts.includes('bad')
        ? openaiReply([])
        : openaiReply(texts.map((text, i) => ({ i, t: `O:${text}` })));
    const result = await run({ items: items('good', 'bad'), source: 'en' });
    expect(result.outcome).toEqual({ status: 'done', data: { total: 2, failed: 1 } });
    expect(result.byId.i0).toMatchObject({ text: 'O:good', disposition: 'translated' });
    expect(result.byId.i1).toMatchObject({ error: { code: 'validation/bad-response' } });
    await cached(cache, 1);
  });

  it('aborts the fetch when the caller cancels', async () => {
    const { providers, service, request } = setup();
    providers.handlers.google = hang;
    const handle = request({ items: items('Hello') });
    await vi.waitFor(() => expect(providers.calls).toHaveLength(1));
    handle.cancel();
    expect(await handle.outcome).toEqual({ status: 'cancelled' });
    await vi.waitFor(() => expect(providers.aborts()).toBe(1));
    await vi.waitFor(() => expect(service.scheduler.inspect().active.mt).toBe(0));
    expect(service.scheduler.inspect().segments).toBe(0);
  });

  it('aborts every request of a port when it disconnects', async () => {
    const { providers, service, request, pairs } = setup();
    providers.handlers.google = hang;
    const first = request({ items: items('one') });
    const second = request({ items: items('two', 'three') });
    await vi.waitFor(() => expect(providers.calls).toHaveLength(2));
    pairs[0]?.breakConnection();
    expect(await first.outcome).toMatchObject({
      status: 'error',
      error: { code: 'network/port-disconnected' },
    });
    expect(await second.outcome).toMatchObject({ status: 'error' });
    await vi.waitFor(() => expect(providers.aborts()).toBe(2));
    await vi.waitFor(() => expect(service.scheduler.inspect().active.mt).toBe(0));
  });

  it('rejects oversized payloads', async () => {
    const { providers, run } = setup();
    const tooMany = await run({
      items: Array.from({ length: 201 }, (_, i) => ({ id: `${i}`, text: 'x' })),
    });
    expect(tooMany.outcome).toMatchObject({
      status: 'error',
      error: { code: 'validation/payload-too-large' },
    });
    const tooLong = await run({ items: [{ id: 'a', text: 'x'.repeat(50_001) }] });
    expect(tooLong.outcome).toMatchObject({
      status: 'error',
      error: { code: 'validation/payload-too-large' },
    });
    expect(providers.calls).toHaveLength(0);
  });

  it('uses a different cache key after switching the engine', async () => {
    const { providers, config, cache, run } = setup();
    await run({ items: items('Hello') });
    await cached(cache, 1);
    config.translation.engine = 'openai';
    const result = await run({ items: items('Hello') });
    expect(result.byId.i0).toEqual({
      id: 'i0',
      text: 'O:Hello',
      disposition: 'translated',
      cached: false,
    });
    expect(providers.calls.map((call) => new URL(call.url).hostname)).toEqual([
      'translate.googleapis.com',
      'api.openai.com',
    ]);
  });

  it('ends an unanswered segment with a timeout at the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { providers, service, request } = setup();
    providers.handlers.google = hang;
    const handle = request({ items: items('Hello') });
    // Hashing and IndexedDB run on real time: wait for the submission before moving the clock.
    for (let i = 0; i < 1000 && providers.calls.length === 0; i += 1) await flush();
    expect(providers.calls).toHaveLength(1);
    // Header timeout at 15s, retry at 16s, segment deadline at 30s from submission.
    await vi.advanceTimersByTimeAsync(29_999);
    await flush();
    expect(handle.chunks).toEqual([]);
    expect(providers.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(await handle.outcome).toEqual({ status: 'done', data: { total: 1, failed: 1 } });
    expect(handle.chunks).toEqual([
      { id: 'i0', error: expect.objectContaining({ code: 'network/timeout' }) },
    ]);
    expect(providers.aborts()).toBe(2);
    expect(service.scheduler.inspect().segments).toBe(0);
  });

  it('reports a missing host permission for the custom endpoint without fetching', async () => {
    const denied = appError('config', 'config/permission-missing', 'denied');
    const { providers, config, run } = setup({ checkPermission: async () => fail(denied) });
    config.translation.engine = 'custom';
    config.providers.custom = { baseURL: 'https://llm.example.com/v1', model: 'm' };
    const result = await run({ items: items('Hello') });
    expect(result.outcome).toEqual({ status: 'done', data: { total: 1, failed: 1 } });
    expect(result.byId.i0).toMatchObject({ error: { code: 'config/permission-missing' } });
    expect(providers.calls).toHaveLength(0);
  });
});

describe('translate service: endpoint checks', () => {
  const denyAll = vi.fn(async () => false);
  const realCheck = (engine: Parameters<typeof checkEngineEndpoint>[0], baseURL: string) =>
    checkEngineEndpoint(engine, baseURL, { contains: denyAll });

  it('rejects openai on a non-built-in https endpoint without the grant', async () => {
    const { providers, config, run } = setup({ checkPermission: realCheck });
    config.translation.engine = 'openai';
    config.providers.openai.baseURL = 'https://proxy.example.com/v1';
    const result = await run({ items: items('Hello'), source: 'en' });
    expect(result.byId.i0).toMatchObject({ error: { code: 'config/permission-missing' } });
    expect(providers.calls).toHaveLength(0);
  });

  it('rejects openai on plain http to a non-local host', async () => {
    const { providers, config, run } = setup({ checkPermission: realCheck });
    config.translation.engine = 'openai';
    config.providers.openai.baseURL = 'http://proxy.example.com/v1';
    const result = await run({ items: items('Hello'), source: 'en' });
    expect(result.byId.i0).toMatchObject({ error: { code: 'config/invalid-base-url' } });
    expect(providers.calls).toHaveLength(0);
  });

  it('lets built-in endpoints through without asking for a grant', async () => {
    denyAll.mockClear();
    const { providers, config, run } = setup({ checkPermission: realCheck });
    config.translation.engine = 'openai';
    const result = await run({ items: items('Hello'), source: 'en' });
    expect(result.byId.i0).toMatchObject({ text: 'O:Hello' });
    expect(providers.calls).toHaveLength(1);
    expect(denyAll).not.toHaveBeenCalled();
  });
});

describe('translate service: preprocessing and results', () => {
  it('strips zero-width characters before translating', async () => {
    const { run } = setup();
    const result = await run({ items: items('​Hello﻿ ') });
    expect(result.byId.i0).toMatchObject({ text: 'G:Hello', disposition: 'translated' });
  });

  it('returns blank items unchanged without a request', async () => {
    const { providers, run } = setup();
    const result = await run({ items: items(' ​‌ ', '') });
    expect(result.outcome).toEqual({ status: 'done', data: { total: 2, failed: 0 } });
    expect(result.byId.i0).toEqual({
      id: 'i0',
      text: ' ​‌ ',
      disposition: 'unchanged',
      cached: false,
    });
    expect(result.byId.i1).toMatchObject({ disposition: 'unchanged' });
    expect(providers.calls).toHaveLength(0);
  });

  it('reports an empty translation as an error and does not cache it', async () => {
    const { providers, cache, run } = setup();
    providers.handlers.google = (texts) =>
      jsonResponse(texts.map((text) => [text === 'Empty' ? '  ' : `G:${text}`, 'en']));
    const result = await run({ items: items('Fine', 'Empty') });
    expect(result.outcome).toEqual({ status: 'done', data: { total: 2, failed: 1 } });
    expect(result.byId.i1).toMatchObject({ error: { code: 'validation/empty-translation' } });
    await cached(cache, 1);
    const again = await run({ items: items('Empty') });
    expect(again.byId.i0).toMatchObject({ error: { code: 'validation/empty-translation' } });
    expect(providers.calls).toHaveLength(2);
  });

  it('marks a translation equal to the source as unchanged and caches it', async () => {
    const { providers, cache, run } = setup();
    providers.handlers.google = (texts) =>
      jsonResponse(texts.map((text) => [` ${text.toLowerCase()} `, 'en']));
    const result = await run({ items: items('GitHub  API') });
    expect(result.byId.i0).toMatchObject({ disposition: 'unchanged', cached: false });
    await cached(cache, 1);
    const again = await run({ items: items('GitHub  API') });
    expect(again.byId.i0).toMatchObject({ disposition: 'unchanged', cached: true });
  });

  it('falls back to the per-item Google endpoint on a network error', async () => {
    const { providers, run } = setup();
    providers.handlers.google = () => {
      throw new TypeError('Failed to fetch');
    };
    const result = await run({ items: items('Hello', 'World') });
    expect(result.outcome).toEqual({ status: 'done', data: { total: 2, failed: 0 } });
    expect(result.byId.i0).toMatchObject({ text: 'S:Hello' });
    expect(result.byId.i1).toMatchObject({ text: 'S:World' });
    expect(providers.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /translate_a/t',
      'GET /translate_a/single',
      'GET /translate_a/single',
    ]);
  });
});
