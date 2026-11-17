import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AppError, appError } from '@/lib/errors';
import {
  createPortClient,
  type Outcome,
  PING_INTERVAL_MS,
  type PortContext,
  type PortLike,
  servePort,
} from './port';

// ------------------------------------------------------------ test ports

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

/** Two connected ends with chrome-like semantics: async delivery, throw after disconnect. */
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
      // Like chrome: only the *other* end gets onDisconnect.
      queueMicrotask(() => {
        for (const listener of other.disconnectListeners) listener();
      });
    },
  });
  return {
    client: side(a, b),
    server: side(b, a),
    /** Connection lost (e.g. SW terminated): both ends see onDisconnect. */
    breakConnection() {
      connected = false;
      for (const listener of [...a.disconnectListeners, ...b.disconnectListeners]) listener();
    },
  };
}

/** A client-side port that records frames and lets the test push frames in. */
function recordingPort() {
  const ends = endpoint();
  const sent: Record<string, unknown>[] = [];
  const port: PortLike = {
    onMessage: ends.onMessage,
    onDisconnect: ends.onDisconnect,
    postMessage: (message) => void sent.push(message as Record<string, unknown>),
    disconnect: vi.fn(),
  };
  return {
    port,
    sent,
    deliver: (frame: unknown) => {
      for (const listener of ends.messageListeners) listener(frame);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Handler = (payload: string, ctx: PortContext<string>) => Promise<string>;

function connected(handler: Handler) {
  const pairs: ReturnType<typeof createPortPair>[] = [];
  const connect = vi.fn(() => {
    const pair = createPortPair();
    servePort(pair.server, handler);
    pairs.push(pair);
    return pair.client;
  });
  return { client: createPortClient<string, string, string>(connect), connect, pairs };
}

afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------ tests

describe('port transport', () => {
  it('streams chunks and resolves with done', async () => {
    const { client } = connected(async (payload, ctx) => {
      ctx.emit('a');
      ctx.emit('b');
      return payload.toUpperCase();
    });
    const chunks: string[] = [];
    const request = client.request('hi', (chunk) => chunks.push(chunk));
    expect(await request.outcome).toEqual({ status: 'done', data: 'HI' });
    expect(chunks).toEqual(['a', 'b']);
  });

  it('forwards an AppError as an error frame', async () => {
    const { client } = connected(async () => {
      throw appError('provider', 'provider/quota', 'quota', { retryable: true });
    });
    expect(await client.request('x').outcome).toEqual({
      status: 'error',
      error: { kind: 'provider', code: 'provider/quota', message: 'quota', retryable: true },
    });
  });

  it('maps a non-AppError throw to internal', async () => {
    const { client } = connected(async () => {
      throw new Error('boom');
    });
    expect(await client.request('x').outcome).toMatchObject({
      status: 'error',
      error: { kind: 'internal', message: 'boom' },
    });
  });

  it('cancels one request: its server signal aborts, others continue', async () => {
    const signals: AbortSignal[] = [];
    const gates = [deferred<string>(), deferred<string>()];
    const { client } = connected((payload, ctx) => {
      signals.push(ctx.signal);
      return gates[Number(payload)]?.promise ?? Promise.reject(new Error('no gate'));
    });
    const first = client.request('0');
    const second = client.request('1');
    await flush();

    first.cancel();
    expect(await first.outcome).toEqual({ status: 'cancelled' });
    await flush();
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    gates[1]?.resolve('ok');
    expect(await second.outcome).toEqual({ status: 'done', data: 'ok' });
  });

  it('cancelAll ends every request and aborts them on the server', async () => {
    const signals: AbortSignal[] = [];
    const { client } = connected((_payload, ctx) => {
      signals.push(ctx.signal);
      return new Promise(() => undefined);
    });
    const requests = [client.request('a'), client.request('b')];
    await flush();
    client.cancelAll();
    for (const request of requests) {
      expect(await request.outcome).toEqual({ status: 'cancelled' });
    }
    await flush();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  it('drops chunks and late frames after cancel, and ignores unknown ids', async () => {
    const { port, deliver } = recordingPort();
    const client = createPortClient<string, string, string>(() => port);
    const onChunk = vi.fn();
    const request = client.request('x', onChunk);
    deliver({ t: 'chunk', id: request.id, data: 'before' });
    request.cancel();
    deliver({ t: 'chunk', id: request.id, data: 'after' });
    deliver({ t: 'done', id: request.id, data: 'late' });
    deliver({ t: 'done', id: 'unknown', data: 'x' });
    expect(onChunk).toHaveBeenCalledOnce();
    expect(await request.outcome).toEqual({ status: 'cancelled' });
  });

  it('on disconnect: server aborts all, client fails all retryably, next request reconnects', async () => {
    const signals: AbortSignal[] = [];
    let hang = true;
    const { client, connect, pairs } = connected(async (payload, ctx) => {
      signals.push(ctx.signal);
      if (hang) await new Promise(() => undefined);
      return payload;
    });
    const requests = [client.request('a'), client.request('b')];
    await flush();

    pairs[0]?.breakConnection();
    for (const request of requests) {
      expect(await request.outcome).toEqual({
        status: 'error',
        error: expect.objectContaining({ code: 'network/port-disconnected', retryable: true }),
      });
    }
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);

    hang = false;
    expect(await client.request('c').outcome).toEqual({ status: 'done', data: 'c' });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('dispose cancels in-flight requests instead of leaving them pending', async () => {
    const signals: AbortSignal[] = [];
    const { client } = connected((_payload, ctx) => {
      signals.push(ctx.signal);
      return new Promise(() => undefined);
    });
    const request = client.request('a');
    await flush();
    client.dispose();
    expect(await request.outcome).toEqual({ status: 'cancelled' });
    await flush();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('treats a throwing postMessage as a disconnect and reconnects next time', async () => {
    const broken: PortLike = {
      ...recordingPort().port,
      postMessage: () => {
        throw new Error('Attempting to use a disconnected port object');
      },
    };
    const healthy = recordingPort();
    const connect = vi
      .fn<() => PortLike>()
      .mockReturnValueOnce(broken)
      .mockReturnValue(healthy.port);
    const client = createPortClient<string, string, string>(connect);

    expect(await client.request('a').outcome).toEqual({
      status: 'error',
      error: expect.objectContaining({ code: 'network/port-disconnected', retryable: true }),
    });
    client.request('b');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(healthy.sent).toMatchObject([{ t: 'req', payload: 'b' }]);
  });

  it('classifies a context-invalidated connect failure as non-retryable', async () => {
    const client = createPortClient<string, string, string>(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(await client.request('a').outcome).toEqual({
      status: 'error',
      error: expect.objectContaining({ code: 'internal/context-invalidated', retryable: false }),
    });
  });

  it('server ignores a duplicate request id', async () => {
    const pair = createPortPair();
    const handler = vi.fn(async (payload: string) => payload);
    servePort(pair.server, handler);
    const frames: unknown[] = [];
    pair.client.onMessage.addListener((frame) => frames.push(frame));
    pair.client.postMessage({ t: 'req', id: 'same', payload: 'one' });
    pair.client.postMessage({ t: 'req', id: 'same', payload: 'two' });
    await flush();
    expect(handler).toHaveBeenCalledOnce();
    expect(frames).toEqual([{ t: 'done', id: 'same', data: 'one' }]);
  });

  it('server sends nothing when the handler finishes after being aborted', async () => {
    const pair = createPortPair();
    const gate = deferred<string>();
    let ctx: PortContext<string> | undefined;
    servePort<string, string, string>(pair.server, (_payload, context) => {
      ctx = context;
      return gate.promise;
    });
    const frames: unknown[] = [];
    pair.client.onMessage.addListener((frame) => frames.push(frame));
    pair.client.postMessage({ t: 'req', id: 'r1', payload: 'x' });
    await flush();
    pair.client.postMessage({ t: 'cancel', id: 'r1' });
    await flush();
    ctx?.emit('late chunk');
    gate.resolve('late result');
    await flush();
    expect(ctx?.signal.aborted).toBe(true);
    expect(frames).toEqual([]);
  });

  it('server ends an unserializable response with a non-retryable internal error', async () => {
    const pair = createPortPair();
    servePort<string, string, unknown>(pair.server, async (payload) => {
      if (payload === 'cycle') {
        const loop: Record<string, unknown> = {};
        loop.self = loop;
        return loop;
      }
      return payload;
    });
    const frames: Record<string, unknown>[] = [];
    pair.client.onMessage.addListener((frame) => frames.push(frame as Record<string, unknown>));
    pair.client.postMessage({ t: 'req', id: 'bad', payload: 'cycle' });
    pair.client.postMessage({ t: 'req', id: 'good', payload: 'fine' });
    await flush();
    expect(frames).toContainEqual({ t: 'done', id: 'good', data: 'fine' });
    expect(frames).toContainEqual({
      t: 'error',
      id: 'bad',
      error: expect.objectContaining({
        kind: 'internal',
        code: 'internal/unserializable-response',
        retryable: false,
      }),
    });
  });

  it('server passes every error frame through decorateError, which reaches the client', async () => {
    const decorateError = vi.fn((error: AppError) =>
      error.code === 'provider/quota' ? { ...error, userMessage: '额度已用完。' } : error,
    );
    const connect = () => {
      const pair = createPortPair();
      servePort<string, string, string>(
        pair.server,
        async () => {
          throw appError('provider', 'provider/quota', 'quota');
        },
        { decorateError },
      );
      return pair.client;
    };
    const client = createPortClient<string, string, string>(connect);
    expect(await client.request('x').outcome).toEqual({
      status: 'error',
      error: {
        kind: 'provider',
        code: 'provider/quota',
        message: 'quota',
        retryable: false,
        userMessage: '额度已用完。',
      },
    });
    expect(decorateError).toHaveBeenCalledTimes(1);
  });

  it('server decorates its own unserializable-response error too', async () => {
    const pair = createPortPair();
    servePort<string, string, unknown>(
      pair.server,
      async () => {
        const loop: Record<string, unknown> = {};
        loop.self = loop;
        return loop;
      },
      { decorateError: (error) => ({ ...error, userMessage: `copy:${error.code}` }) },
    );
    const frames: Record<string, unknown>[] = [];
    pair.client.onMessage.addListener((frame) => frames.push(frame as Record<string, unknown>));
    pair.client.postMessage({ t: 'req', id: 'bad', payload: 'cycle' });
    await flush();
    expect(frames).toEqual([
      {
        t: 'error',
        id: 'bad',
        error: expect.objectContaining({
          code: 'internal/unserializable-response',
          userMessage: 'copy:internal/unserializable-response',
        }),
      },
    ]);
  });

  it('server disconnects the port when postMessage throws, so clients do not hang', async () => {
    const pair = createPortPair();
    const server: PortLike = {
      ...pair.server,
      postMessage: () => {
        throw new Error('port is broken');
      },
    };
    servePort<string, string, string>(server, async (payload) => payload);
    const client = createPortClient<string, string, string>(() => pair.client);
    const first = client.request('a');
    const second = client.request('b');
    const outcomes = await Promise.race([
      Promise.all([first.outcome, second.outcome]),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 50)),
    ]);
    expect(outcomes).not.toBe('hung');
    for (const outcome of outcomes as Outcome<string>[]) {
      expect(outcome).toEqual({
        status: 'error',
        error: expect.objectContaining({ code: 'network/port-disconnected' }),
      });
    }
  });

  it('client rejects an unserializable payload without affecting in-flight requests', async () => {
    const gate = deferred<string>();
    const { client, connect } = connected((payload) =>
      payload === 'slow' ? gate.promise : Promise.resolve(payload),
    );
    const first = client.request('slow');
    await flush();
    const bad = client.request(10n as unknown as string);
    expect(await bad.outcome).toEqual({
      status: 'error',
      error: expect.objectContaining({
        kind: 'validation',
        code: 'validation/unserializable-payload',
        retryable: false,
      }),
    });
    expect(connect).toHaveBeenCalledTimes(1);
    gate.resolve('slow-result');
    expect(await first.outcome).toEqual({ status: 'done', data: 'slow-result' });
  });

  it('client does not connect for an unserializable payload', async () => {
    const connect = vi.fn<() => PortLike>(() => recordingPort().port);
    const client = createPortClient<string, string, string>(connect);
    const outcome = await client.request(10n as unknown as string).outcome;
    expect(outcome.status).toBe('error');
    expect(connect).not.toHaveBeenCalled();
  });

  it('a throwing onChunk fails only that request with chunk-handler-failed and cancels it', async () => {
    const { port, sent, deliver } = recordingPort();
    const client = createPortClient<string, string, string>(() => port);
    const request = client.request('x', () => {
      throw new Error('boom');
    });
    expect(() => deliver({ t: 'chunk', id: request.id, data: 'c' })).not.toThrow();
    expect(await request.outcome).toEqual({
      status: 'error',
      error: expect.objectContaining({ code: 'internal/chunk-handler-failed', retryable: false }),
    });
    expect(sent).toContainEqual({ t: 'cancel', id: request.id });
  });

  it('server ignores a cancel frame whose id is not a string', async () => {
    const pair = createPortPair();
    const gate = deferred<string>();
    let ctx: PortContext<string> | undefined;
    servePort<string, string, string>(pair.server, (_payload, context) => {
      ctx = context;
      return gate.promise;
    });
    pair.client.postMessage({ t: 'req', id: 'r1', payload: 'x' });
    await flush();
    pair.client.postMessage({ t: 'cancel', id: 123 });
    await flush();
    expect(ctx?.signal.aborted).toBe(false);
    pair.client.postMessage({ t: 'cancel' });
    await flush();
    expect(ctx?.signal.aborted).toBe(true);
  });

  it('pings every 20s while requests are in flight and stops when idle', async () => {
    vi.useFakeTimers();
    const { port, sent, deliver } = recordingPort();
    const connect = vi.fn(() => port);
    const client = createPortClient<string, string, string>(connect);

    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(connect).not.toHaveBeenCalled();

    const request = client.request('x');
    vi.advanceTimersByTime(PING_INTERVAL_MS - 1);
    expect(sent.filter((frame) => frame.t === 'ping')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent.filter((frame) => frame.t === 'ping')).toHaveLength(1);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(sent.filter((frame) => frame.t === 'ping')).toHaveLength(2);

    deliver({ t: 'done', id: request.id, data: 'ok' });
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);
    expect(sent.filter((frame) => frame.t === 'ping')).toHaveLength(2);
  });
});
