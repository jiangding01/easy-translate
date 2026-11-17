import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '@/lib/config/defaults';
import { type AppError, appError } from '@/lib/errors';
import type { PortLike } from '@/lib/messaging/port';
import { TRANSLATE_PORT_NAME, type TranslateChunk } from '@/lib/messaging/protocol';
import { createTranslatePortHost } from './port-host';
import { createScheduler } from './scheduler';
import { createTranslateService } from './service';
import type { ProviderAdapter } from './types';

function fakePort(name: string) {
  const frames: unknown[] = [];
  const messageListeners: ((message: unknown) => void)[] = [];
  const port: PortLike & { name: string } = {
    name,
    postMessage: (message) => void frames.push(message),
    onMessage: { addListener: (cb) => void messageListeners.push(cb) },
    onDisconnect: { addListener: () => {} },
    disconnect: () => {},
  };
  return {
    port,
    frames,
    send: (frame: unknown) => {
      for (const listener of messageListeners) listener(frame);
    },
  };
}

describe('translate port host', () => {
  it('ignores ports with another name', () => {
    const translate = vi.fn();
    const host = createTranslatePortHost({ translate }, TRANSLATE_PORT_NAME);
    const other = fakePort('something-else');
    host(other.port);
    other.send({ t: 'req', id: '1', payload: {} });
    expect(translate).not.toHaveBeenCalled();
  });

  it('gives every port its own stable caller', async () => {
    const callers: (string | undefined)[] = [];
    const translate = vi.fn(async (_payload: unknown, ctx: { caller?: string }) => {
      callers.push(ctx.caller);
      return { total: 0, failed: 0 };
    });
    const host = createTranslatePortHost({ translate }, TRANSLATE_PORT_NAME);
    const a = fakePort(TRANSLATE_PORT_NAME);
    const b = fakePort(TRANSLATE_PORT_NAME);
    host(a.port);
    host(b.port);
    a.send({ t: 'req', id: '1', payload: {} });
    a.send({ t: 'req', id: '2', payload: {} });
    b.send({ t: 'req', id: '1', payload: {} });
    await vi.waitFor(() => expect(callers).toHaveLength(3));
    expect(callers[0]).toBe(callers[1]);
    expect(callers[2]).not.toBe(callers[0]);
  });

  it('passes chunk errors and error frames through decorateError', async () => {
    const decorateError = (error: AppError) => ({ ...error, userMessage: `copy:${error.code}` });
    const translate = vi.fn(
      async (_payload: unknown, ctx: { emit(chunk: TranslateChunk): void }) => {
        ctx.emit({ id: 'a', text: 'A', disposition: 'translated', cached: false });
        ctx.emit({ id: 'b', error: appError('provider', 'provider/unauthorized', '401') });
        throw appError('network', 'network/timeout', 'slow');
      },
    );
    const host = createTranslatePortHost({ translate }, TRANSLATE_PORT_NAME, { decorateError });
    const port = fakePort(TRANSLATE_PORT_NAME);
    host(port.port);
    port.send({ t: 'req', id: '1', payload: {} });
    await vi.waitFor(() => expect(port.frames).toHaveLength(3));
    expect(port.frames).toEqual([
      {
        t: 'chunk',
        id: '1',
        data: { id: 'a', text: 'A', disposition: 'translated', cached: false },
      },
      {
        t: 'chunk',
        id: '1',
        data: {
          id: 'b',
          error: expect.objectContaining({
            code: 'provider/unauthorized',
            userMessage: 'copy:provider/unauthorized',
          }),
        },
      },
      {
        t: 'error',
        id: '1',
        error: expect.objectContaining({
          code: 'network/timeout',
          userMessage: 'copy:network/timeout',
        }),
      },
    ]);
  });

  it('round-robins the scheduler between two ports', async () => {
    const started: string[] = [];
    const adapter: ProviderAdapter = {
      kind: 'mt',
      limits: { maxItems: 1, maxChars: 1000 },
      async *translate(batch) {
        started.push(batch[0] ?? '');
        yield { type: 'item', index: 0, text: `T:${batch[0]}` };
      },
    };
    const service = createTranslateService({
      getConfig: async () => createDefaultConfig('zh-CN'),
      secrets: { get: async () => undefined },
      cache: {
        getMany: async () => new Map(),
        touch: async () => {},
        put: async () => {},
        stats: async () => ({ count: 0, totalBytes: 0 }),
        clear: async () => {},
      },
      getAdapter: () => adapter,
      detectLanguage: null,
      scheduler: createScheduler(),
    });
    const host = createTranslatePortHost(service, TRANSLATE_PORT_NAME);
    const a = fakePort(TRANSLATE_PORT_NAME);
    const b = fakePort(TRANSLATE_PORT_NAME);
    host(a.port);
    host(b.port);
    const items = (prefix: string) =>
      Array.from({ length: 4 }, (_, i) => ({ id: `${i}`, text: `${prefix}${i}` }));
    a.send({ t: 'req', id: 'r', payload: { items: items('a'), target: 'zh-CN', source: 'en' } });
    b.send({ t: 'req', id: 'r', payload: { items: items('b'), target: 'zh-CN', source: 'en' } });
    await vi.waitFor(() => expect(started).toHaveLength(8), { timeout: 5000 });
    // Without per-port callers all of "a" would run before any "b".
    expect(started.indexOf('b0')).toBeLessThan(started.indexOf('a3'));
    expect(started.indexOf('a1')).toBeLessThan(started.indexOf('b3'));
  });
});
