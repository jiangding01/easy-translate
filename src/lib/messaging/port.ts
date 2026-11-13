import { browser } from 'wxt/browser';
import { type AppError, appError, toAppError } from '@/lib/errors';

// Business-agnostic request/stream transport over a long-lived runtime Port.
// The background registers the actual translate handler in M1.

/** Minimal subset of chrome.runtime.Port, so tests can inject an in-memory port. */
export interface PortLike {
  postMessage(message: unknown): void;
  onMessage: { addListener(callback: (message: unknown) => void): void };
  onDisconnect: { addListener(callback: () => void): void };
  disconnect(): void;
}

export type UpFrame<P> =
  | { t: 'req'; id: string; payload: P }
  | { t: 'cancel'; id?: string }
  | { t: 'ping' };

export type DownFrame<C, D> =
  | { t: 'chunk'; id: string; data: C }
  | { t: 'done'; id: string; data: D }
  | { t: 'error'; id: string; error: AppError };

export type Outcome<D> =
  | { status: 'done'; data: D }
  | { status: 'error'; error: AppError }
  | { status: 'cancelled' };

export interface PortContext<C> {
  /** Aborted on cancel or disconnect; emits and results after that are dropped. */
  signal: AbortSignal;
  emit(chunk: C): void;
}

export type PortHandler<P, C, D> = (payload: P, ctx: PortContext<C>) => Promise<D>;

export interface PortRequest<D> {
  id: string;
  outcome: Promise<Outcome<D>>;
  cancel(): void;
}

export interface PortClient<P, C, D> {
  request(payload: P, onChunk?: (chunk: C) => void): PortRequest<D>;
  cancelAll(): void;
  dispose(): void;
}

/** Since Chrome 114 a port message resets the SW idle timer; an open port alone does not. */
export const PING_INTERVAL_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ---------------------------------------------------------------- server

/** Serves one port: one AbortController per request; disconnect aborts them all. */
export function servePort<P, C, D>(port: PortLike, handler: PortHandler<P, C, D>): void {
  const inflight = new Map<string, AbortController>();
  let connected = true;

  function abortAll() {
    for (const controller of inflight.values()) controller.abort();
    inflight.clear();
  }

  function handleDisconnect() {
    connected = false;
    abortAll();
  }

  function send(frame: DownFrame<C, D>) {
    if (!connected) return;
    try {
      port.postMessage(frame);
    } catch {
      handleDisconnect();
    }
  }

  function start(id: string, payload: P) {
    // A duplicate id would corrupt the first request's frames: refuse to run it.
    if (inflight.has(id)) return;
    const controller = new AbortController();
    const { signal } = controller;
    inflight.set(id, controller);

    const finish = (frame: DownFrame<C, D>) => {
      if (signal.aborted) return;
      inflight.delete(id);
      send(frame);
    };
    const ctx: PortContext<C> = {
      signal,
      emit: (chunk) => {
        if (!signal.aborted) send({ t: 'chunk', id, data: chunk });
      },
    };
    Promise.resolve()
      .then(() => handler(payload, ctx))
      .then(
        (data) => finish({ t: 'done', id, data }),
        (error: unknown) => finish({ t: 'error', id, error: toAppError(error) }),
      );
  }

  port.onMessage.addListener((frame) => {
    if (!isRecord(frame)) return;
    if (frame.t === 'req' && typeof frame.id === 'string') {
      start(frame.id, frame.payload as P);
    } else if (frame.t === 'cancel') {
      if (typeof frame.id === 'string') {
        inflight.get(frame.id)?.abort();
        inflight.delete(frame.id);
      } else {
        abortAll();
      }
    }
    // 'ping' needs no reply: receiving it already keeps the SW alive.
  });
  port.onDisconnect.addListener(handleDisconnect);
}

/** Call synchronously at the top level of the background script. */
export function listenPort<P, C, D>(name: string, handler: PortHandler<P, C, D>): () => void {
  const listener = (port: PortLike & { name: string }) => {
    if (port.name === name) servePort(port, handler);
  };
  browser.runtime.onConnect.addListener(listener);
  return () => browser.runtime.onConnect.removeListener(listener);
}

// ---------------------------------------------------------------- client

function isContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /context invalidated/i.test(error.message);
}

const portDisconnected = () =>
  appError('network', 'network/port-disconnected', 'Port disconnected', { retryable: true });

function connectionError(error: unknown): AppError {
  // After an extension reload/update every retry would fail the same way.
  return isContextInvalidated(error)
    ? appError('internal', 'internal/context-invalidated', 'Extension context invalidated')
    : portDisconnected();
}

/** crypto.randomUUID needs a secure context, which content scripts on http pages lack. */
function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Lazily connects on the first request and reconnects on the next request
 * after a disconnect. Disconnects end every in-flight request with a
 * retryable error; retrying is the caller's decision.
 *
 * Contract for callers (M2/M3): call `cancelAll()` on the old session before
 * starting a new one (SPA navigation, engine switch, stop). Frames for ended
 * ids are dropped, which is then enough to keep stale results out.
 */
export function createPortClient<P, C, D>(
  connect: () => PortLike,
  options: { pingIntervalMs?: number } = {},
): PortClient<P, C, D> {
  const pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
  const pending = new Map<
    string,
    { onChunk?: (chunk: C) => void; resolve: (o: Outcome<D>) => void }
  >();
  let port: PortLike | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  function syncPing() {
    if (pending.size > 0 && pingTimer === undefined) {
      pingTimer = setInterval(() => post({ t: 'ping' }), pingIntervalMs);
    } else if (pending.size === 0 && pingTimer !== undefined) {
      clearInterval(pingTimer);
      pingTimer = undefined;
    }
  }

  function settle(id: string, outcome: Outcome<D>): boolean {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    entry.resolve(outcome);
    syncPing();
    return true;
  }

  function settleAll(outcome: Outcome<D>) {
    for (const id of [...pending.keys()]) settle(id, outcome);
  }

  /** Forget the current port (closing it if still open) and fail everything in flight. */
  function drop(error: AppError) {
    const current = port;
    port = undefined;
    try {
      current?.disconnect();
    } catch {
      // Already gone.
    }
    settleAll({ status: 'error', error });
  }

  function onFrame(frame: unknown) {
    if (!isRecord(frame) || typeof frame.id !== 'string') return;
    const entry = pending.get(frame.id);
    if (!entry) return; // Late frame for a finished/cancelled or unknown id.
    if (frame.t === 'chunk') entry.onChunk?.(frame.data as C);
    else if (frame.t === 'done') settle(frame.id, { status: 'done', data: frame.data as D });
    else if (frame.t === 'error') {
      settle(frame.id, { status: 'error', error: toAppError(frame.error) });
    }
  }

  function ensurePort(): PortLike {
    if (port) return port;
    const next = connect();
    next.onMessage.addListener((frame) => {
      if (port === next) onFrame(frame);
    });
    next.onDisconnect.addListener(() => {
      if (port !== next) return;
      port = undefined;
      settleAll({ status: 'error', error: portDisconnected() });
    });
    port = next;
    return next;
  }

  /** Every postMessage is guarded: a throw means the port is unusable. */
  function post(frame: UpFrame<P>, connectIfNeeded = false) {
    try {
      (connectIfNeeded ? ensurePort() : port)?.postMessage(frame);
    } catch (error) {
      drop(connectionError(error));
    }
  }

  return {
    request(payload, onChunk) {
      const id = createRequestId();
      let resolve: (outcome: Outcome<D>) => void = () => undefined;
      const outcome = new Promise<Outcome<D>>((r) => {
        resolve = r;
      });
      pending.set(id, { onChunk, resolve });
      syncPing();
      post({ t: 'req', id, payload }, true);
      return {
        id,
        outcome,
        cancel() {
          if (settle(id, { status: 'cancelled' })) post({ t: 'cancel', id });
        },
      };
    },

    cancelAll() {
      if (pending.size === 0) return;
      settleAll({ status: 'cancelled' });
      post({ t: 'cancel' });
    },

    dispose() {
      settleAll({ status: 'cancelled' });
      // A local disconnect() never fires our own onDisconnect, so settle first.
      const current = port;
      port = undefined;
      try {
        current?.disconnect();
      } catch {
        // Already gone.
      }
    },
  };
}
