import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@/lib/errors';
import type { onMessage, PageState } from '@/lib/messaging/protocol';
import { createBootstrap } from './bootstrap';
import { IDLE_PAGE_STATE, type PageRuntimeDeps, type PageRuntimeFactory } from './runtime-contract';
import type { PageSession } from './session';

type Handler = (message: { data?: unknown }) => Promise<Result<unknown>>;

function fakeSession() {
  let phase: PageState['phase'] = 'idle';
  const events: string[] = [];
  const snapshot = (): PageState => ({ phase, mode: 'bilingual', translated: 0, failed: 0 });
  const session: PageSession = {
    start: vi.fn(async () => {
      events.push('start');
      phase = 'running';
      return snapshot();
    }),
    stop: vi.fn(async () => {
      events.push('stop');
      phase = 'idle';
      return snapshot();
    }),
    toggle: vi.fn(async () => {
      events.push('toggle');
      phase = phase === 'idle' ? 'running' : 'idle';
      return snapshot();
    }),
    setMode: vi.fn(async (mode) => ({ ...snapshot(), mode })),
    retryFailed: vi.fn(snapshot),
    state: vi.fn(snapshot),
    subscribe: vi.fn(() => () => {}),
  };
  return { session, events };
}

const runtime: PageRuntimeDeps = {
  getConfig: vi.fn(),
  watchConfig: vi.fn(),
  reportStatus: vi.fn(),
  listEngines: vi.fn(),
};

function setup(loadFactory?: () => Promise<PageRuntimeFactory>) {
  const handlers = new Map<string, Handler>();
  const fake = fakeSession();
  const create = vi.fn<PageRuntimeFactory>(() => fake.session);
  const load = vi.fn(loadFactory ?? (async () => create));
  const bootstrap = createBootstrap({
    onMessage: ((type: string, handler: Handler) => {
      handlers.set(type, handler);
    }) as unknown as typeof onMessage,
    pageInfo: () => ({ title: 'T', language: 'en' }),
    loadFactory: load,
    runtime,
  });
  const send = (type: string, data?: unknown) => {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no handler for ${type}`);
    return handler({ data });
  };
  return { ...fake, bootstrap, create, load, send };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('bootstrap without a session', () => {
  it('answers page.getInfo itself', async () => {
    const { send, load } = setup();
    expect(await send('page.getInfo')).toEqual({ ok: true, data: { title: 'T', language: 'en' } });
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ['page.getState', undefined],
    ['page.stop', undefined],
    ['page.setMode', 'original'],
    ['page.retryFailed', undefined],
  ])('%s returns the idle state without loading', async (type, data) => {
    const { send, load } = setup();
    expect(await send(type, data)).toEqual({ ok: true, data: IDLE_PAGE_STATE });
    expect(load).not.toHaveBeenCalled();
  });

  it('page.start loads, starts without waiting, and returns the state', async () => {
    const { send, session, create, load } = setup();
    vi.mocked(session.start).mockReturnValue(new Promise(() => undefined));
    const result = await send('page.start', { engine: 'google' });
    expect(result).toMatchObject({ ok: true, data: { phase: 'idle' } });
    expect(load).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(runtime);
    expect(session.start).toHaveBeenCalledWith({ engine: 'google' });
  });

  it('page.start swallows a failed start', async () => {
    const { send, session } = setup();
    vi.mocked(session.start).mockRejectedValue(new Error('boom'));
    expect(await send('page.start')).toMatchObject({ ok: true });
    expect(session.start).toHaveBeenCalledWith({});
  });

  it('page.toggle loads and awaits the toggle', async () => {
    const { send, session } = setup();
    expect(await send('page.toggle')).toMatchObject({ ok: true, data: { phase: 'running' } });
    expect(session.toggle).toHaveBeenCalledOnce();
  });
});

describe('bootstrap with a ready session', () => {
  it('delegates every message and never loads again', async () => {
    const { send, session, load } = setup();
    await send('page.start');
    expect(await send('page.getState')).toMatchObject({ data: { phase: 'running' } });
    await send('page.setMode', 'original');
    expect(session.setMode).toHaveBeenCalledWith('original');
    await send('page.retryFailed');
    expect(session.retryFailed).toHaveBeenCalledOnce();
    expect(await send('page.stop')).toMatchObject({ data: { phase: 'idle' } });
    expect(await send('page.toggle')).toMatchObject({ data: { phase: 'running' } });
    expect(load).toHaveBeenCalledOnce();
  });
});

describe('bootstrap while loading', () => {
  function slowLoad() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { gate, release };
  }

  it('getState waits for the session instead of reporting idle', async () => {
    const { gate, release } = slowLoad();
    const fake = fakeSession();
    const t = setup(async () => {
      await gate;
      return () => fake.session;
    });
    const started = t.send('page.toggle');
    const state = t.send('page.getState');
    release();
    await started;
    expect(await state).toMatchObject({ data: { phase: 'running' } });
  });

  it('two quick toggles start and then stop, in order', async () => {
    const { gate, release } = slowLoad();
    const fake = fakeSession();
    const t = setup(async () => {
      await gate;
      return () => fake.session;
    });
    const first = t.send('page.toggle');
    const second = t.send('page.toggle');
    release();
    await Promise.all([first, second]);
    expect(fake.events).toEqual(['toggle', 'toggle']);
    expect(fake.session.state().phase).toBe('idle');
    expect(t.load).toHaveBeenCalledOnce();
  });

  it('a stop sent during loading is not lost', async () => {
    const { gate, release } = slowLoad();
    const fake = fakeSession();
    const t = setup(async () => {
      await gate;
      return () => fake.session;
    });
    const started = t.send('page.start');
    const stopped = t.send('page.stop');
    release();
    await Promise.all([started, stopped]);
    expect(fake.events).toEqual(['start', 'stop']);
  });

  it('auto-start and a user start share one load and one session', async () => {
    const { gate, release } = slowLoad();
    const fake = fakeSession();
    const create = vi.fn<PageRuntimeFactory>(() => fake.session);
    const t = setup(async () => {
      await gate;
      return create;
    });
    const auto = t.bootstrap.startIfIdle();
    const user = t.send('page.start');
    release();
    await Promise.all([auto, user]);
    expect(t.load).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });
});

describe('startIfIdle', () => {
  it('starts an idle session and leaves a running one alone', async () => {
    const { bootstrap, session, send } = setup();
    await bootstrap.startIfIdle();
    expect(session.start).toHaveBeenCalledOnce();
    await bootstrap.startIfIdle();
    expect(session.start).toHaveBeenCalledOnce();
    expect(await send('page.getState')).toMatchObject({ data: { phase: 'running' } });
  });
});

describe('bootstrap when loading fails', () => {
  it('maps the failure to page-unreachable for every waiter, including those waiting on the session', async () => {
    let fail!: (error: Error) => void;
    const t = setup(
      () =>
        new Promise<PageRuntimeFactory>((_, reject) => {
          fail = reject;
        }),
    );
    // start and toggle trigger the load; getState, stop, setMode and retryFailed arrive
    // while it is in flight and wait on the same session promise.
    const pending = [
      t.send('page.start'),
      t.send('page.toggle'),
      t.send('page.getState'),
      t.send('page.stop'),
      t.send('page.setMode', 'translation'),
      t.send('page.retryFailed'),
    ];
    await Promise.resolve();
    fail(new Error('Failed to fetch'));
    for (const result of await Promise.all(pending)) {
      expect(result).toMatchObject({ ok: false, error: { code: 'network/page-unreachable' } });
    }
    expect(t.load).toHaveBeenCalledOnce();
  });

  it('clears the cache so the next invocation loads again', async () => {
    // In Chrome a failed module import is cached per URL and the dynamic URL is stable
    // within a browser session, so this second load usually fails the same way until the
    // page is reloaded (the page-unreachable message says so). The bootstrap must still
    // not pin the failure: an invalidated context or a fixed extension gets a fresh try.
    let attempt = 0;
    const fake = fakeSession();
    const t = setup(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Failed to fetch');
      return () => fake.session;
    });
    expect(await t.send('page.start')).toMatchObject({ ok: false });
    expect(await t.send('page.getState')).toEqual({ ok: true, data: IDLE_PAGE_STATE });
    expect(await t.send('page.start')).toMatchObject({ ok: true });
    expect(t.load).toHaveBeenCalledTimes(2);
  });

  it('survives a synchronous loader failure', async () => {
    const t = setup(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(await t.send('page.start')).toMatchObject({
      ok: false,
      error: { code: 'network/page-unreachable' },
    });
    expect(await t.send('page.getState')).toEqual({ ok: true, data: IDLE_PAGE_STATE });
  });

  it('auto-start rejects so the caller can ignore it', async () => {
    const t = setup(async () => {
      throw new Error('x');
    });
    await expect(t.bootstrap.startIfIdle()).rejects.toMatchObject({
      code: 'network/page-unreachable',
    });
  });
});
