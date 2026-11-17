// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '@/lib/config/defaults';
import { type AppError, appError } from '@/lib/errors';
import type { Outcome, PortClient } from '@/lib/messaging/port';
import type {
  PageStatus,
  TranslateChunk,
  TranslateDone,
  TranslateRequest,
} from '@/lib/messaging/protocol';
import type { StyleReader } from './dom-rules';
import { watchMutations } from './mutations';
import { IDLE_PAGE_STATE } from './runtime-contract';
import { createPageSession, isEngineLevel } from './session';

const readStyle: StyleReader = (el) => {
  const own = (el as HTMLElement).style?.display;
  if (own) return { display: own };
  return { display: el.tagName === 'DIV' || el.tagName === 'BODY' ? 'block' : 'inline' };
};

interface Call {
  payload: TranslateRequest;
  onChunk?: (chunk: TranslateChunk) => void;
  finish(outcome: Outcome<TranslateDone>): void;
  /** Answers every item with "译:" + text, then completes. */
  answer(): void;
}

function fakePort() {
  const calls: Call[] = [];
  const port: PortClient<TranslateRequest, TranslateChunk, TranslateDone> & { calls: Call[] } = {
    calls,
    request(payload, onChunk) {
      let finish!: (outcome: Outcome<TranslateDone>) => void;
      const outcome = new Promise<Outcome<TranslateDone>>((resolve) => {
        finish = resolve;
      });
      const call: Call = {
        payload,
        onChunk,
        finish,
        answer() {
          for (const item of payload.items) {
            onChunk?.({
              id: item.id,
              text: `译:${item.text}`,
              disposition: 'translated',
              cached: false,
            });
          }
          finish({ status: 'done', data: { total: payload.items.length, failed: 0 } });
        },
      };
      calls.push(call);
      return { id: String(calls.length), outcome, cancel: () => finish({ status: 'cancelled' }) };
    },
    cancelAll() {
      for (const call of calls) call.finish({ status: 'cancelled' });
    },
    dispose() {},
  };
  return port;
}

function setup(markup: string, getConfig = async () => createDefaultConfig('zh-CN')) {
  const configListeners: ((config: ReturnType<typeof createDefaultConfig>) => void)[] = [];
  document.body.innerHTML = markup;
  const before = document.body.innerHTML;
  const port = fakePort();
  const statuses: PageStatus[] = [];
  const observed: Element[] = [];
  const unobserved: Element[] = [];
  // A manual frame clock: subscribers are pushed only when a test runs the frame.
  const frames = new Map<number, () => void>();
  let frameId = 0;
  const runFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback();
  };
  let notify: ((targets: Element[], visible: boolean[]) => void) | undefined;
  /** Each round of page changes the mutation watcher passed on for rescanning. */
  const dirtyRounds: Element[][] = [];
  const session = createPageSession({
    win: window,
    port,
    getConfig,
    watchConfig: (callback) => {
      configListeners.push(callback);
      return () => configListeners.splice(configListeners.indexOf(callback), 1);
    },
    reportStatus: (status) => statuses.push(status),
    createReadStyle: () => readStyle,
    createViewport: (onChange) => {
      notify = onChange;
      return {
        observe: (target) => observed.push(target),
        unobserve: (target) => {
          unobserved.push(target);
        },
        disconnect: () => {
          observed.length = 0;
        },
      };
    },
    createMutationWatch: (options) =>
      watchMutations({
        ...options,
        debounceMs: 5,
        onDirty: (elements) => {
          dirtyRounds.push(elements);
          options.onDirty(elements);
        },
      }),
    scheduleFrame: (callback) => {
      frameId += 1;
      const id = frameId;
      frames.set(id, callback);
      return () => frames.delete(id);
    },
  });
  /** Reports every observed root (or the given ones) as in range. */
  const show = (targets: Element[] = [...observed]) =>
    notify?.(
      targets,
      targets.map(() => true),
    );
  /** Reports the given roots as out of range. */
  const hide = (targets: Element[]) =>
    notify?.(
      targets,
      targets.map(() => false),
    );
  const sentTexts = () => port.calls.flatMap((call) => call.payload.items.map((item) => item.text));
  return {
    session,
    port,
    statuses,
    observed,
    unobserved,
    show,
    hide,
    before,
    sentTexts,
    configListeners,
    runFrame,
    queuedFrames: () => frames.size,
    dirtyRounds,
  };
}

const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const translations = () => [...document.querySelectorAll('et-tr')].map((el) => el.textContent);
const engineError = (code: `${string}/${string}`): AppError =>
  appError('provider', code as AppError['code'], 'engine problem');

beforeEach(() => {
  document.head.innerHTML = '';
});

describe('page session: happy path', () => {
  it('reports IDLE_PAGE_STATE before it has started', () => {
    const { session } = setup('<p>Hello</p>');
    // toEqual: state() carries keys whose value is undefined.
    expect(session.state()).toEqual(IDLE_PAGE_STATE);
  });

  it('translates only what the viewport reports, then restores the page exactly', async () => {
    const { session, port, show, before, statuses, observed } = setup(
      '<p>First paragraph text.</p><p>Second paragraph text.</p>',
    );
    await session.start();
    await wait();
    expect(port.calls).toHaveLength(0);
    show(observed.slice(0, 1));
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    expect(port.calls[0]?.payload.items.map((item) => item.text)).toEqual([
      'First paragraph text.',
    ]);
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toEqual(['译:First paragraph text.']));
    expect(session.state()).toMatchObject({ phase: 'done', translated: 1, failed: 0 });
    expect(statuses.at(-1)).toBe('done');
    await session.stop();
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector('style[data-et]')).toBeNull();
    expect(statuses.at(-1)).toBe('idle');
  });

  it('drops results that arrive after stop', async () => {
    const { session, port, show, before } = setup('<p>Late result paragraph.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const call = port.calls[0] as Call;
    await session.stop();
    call.onChunk?.({
      id: call.payload.items[0]?.id ?? '',
      text: '迟到的译文',
      disposition: 'translated',
      cached: false,
    });
    await wait();
    expect(document.body.innerHTML).toBe(before);
  });

  it('ignores stream delta, reset and phonetic chunks and renders only the final one', async () => {
    const { session, port, show } = setup('<p>Streamed paragraph text.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const call = port.calls[0] as Call;
    const id = call.payload.items[0]?.id ?? '';
    call.onChunk?.({ id, reset: true });
    call.onChunk?.({ id, delta: '半截' });
    call.onChunk?.({ id, phonetic: { uk: 'ˈstriːmd' } });
    await wait();
    expect(translations()).toEqual([]);
    expect(session.state()).toMatchObject({ translated: 0, failed: 0 });
    call.answer();
    await vi.waitFor(() => expect(translations()).toEqual(['译:Streamed paragraph text.']));
  });

  it('renders a repeated text from memory without asking again', async () => {
    const { session, port, show, observed } = setup('<p>Read more here.</p><p>Read more here.</p>');
    await session.start();
    show(observed.slice(0, 1));
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    show(observed.slice(1));
    await vi.waitFor(() => expect(translations()).toHaveLength(2));
    expect(port.calls).toHaveLength(1);
  });

  it('never reuses a translation for a different text that shares its digest', async () => {
    // A real FNV-1a 32-bit collision: a page comment must not plant a "translation" on other text.
    const { session, port, show, observed, sentTexts } = setup(
      '<p>Reader comment number 7123 says hello.</p><p>Reader comment number 260100 says hello.</p>',
    );
    await session.start();
    show(observed.slice(0, 1));
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    show(observed.slice(1));
    await vi.waitFor(() =>
      expect(sentTexts()).toContain('Reader comment number 260100 says hello.'),
    );
    expect(translations()).toEqual(['译:Reader comment number 7123 says hello.']);
  });

  it('switches the mode and keeps the state in sync', async () => {
    const { session, port, show } = setup('<p>Mode switch paragraph.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    expect((await session.setMode('translation')).mode).toBe('translation');
    expect(document.querySelector('p')?.hasAttribute('data-et-only')).toBe(true);
  });
});

describe('page session: lifecycle', () => {
  it('removes only its own stylesheet, never one the page planted', async () => {
    const { session } = setup('<p>Stylesheet ownership text.</p>');
    const planted = document.createElement('style');
    planted.setAttribute('data-et', '');
    document.head.append(planted);
    await session.start();
    expect(document.querySelectorAll('style[data-et]')).toHaveLength(2);
    await session.stop();
    expect([...document.querySelectorAll('style[data-et]')]).toEqual([planted]);
  });

  it('cancels its own requests on stop without touching the shared Port', async () => {
    const { session, port, show } = setup('<p>Own requests only text.</p>');
    const cancelAll = vi.spyOn(port, 'cancelAll');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    await session.stop();
    expect(cancelAll).not.toHaveBeenCalled();
  });

  it('restyles translations when the setting changes, keeping the language fixed', async () => {
    const { session, port, show, configListeners } = setup('<p>Live style paragraph.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    const next = createDefaultConfig('zh-CN');
    next.page.style = 'highlight';
    for (const listener of configListeners) listener(next);
    expect(document.querySelector('et-tr')?.getAttribute('data-et-s')).toBe('highlight');
    await session.stop();
    expect(configListeners).toHaveLength(0);
  });

  it('leaves the page untouched when the config cannot be read', async () => {
    const { session, before, statuses } = setup('<p>Unreadable config text.</p>', async () => {
      throw new Error('storage gone');
    });
    await expect(session.start()).rejects.toThrow('storage gone');
    expect(session.state().phase).toBe('idle');
    expect(statuses.at(-1)).toBe('idle');
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector('style[data-et]')).toBeNull();
  });

  it('a stale start that fails late leaves the newer session running', async () => {
    let failFirst!: (error: Error) => void;
    let reads = 0;
    const { session, statuses } = setup('<p>Stale start text.</p>', () => {
      reads += 1;
      if (reads > 1) return Promise.resolve(createDefaultConfig('zh-CN'));
      return new Promise((_resolve, reject) => {
        failFirst = reject;
      });
    });
    const first = session.start();
    await vi.waitFor(() => expect(reads).toBe(1));
    await session.stop();
    expect((await session.start()).phase).toBe('running');
    failFirst(new Error('storage gone'));
    await expect(first).rejects.toThrow('storage gone');
    await wait();
    expect(session.state().phase).not.toBe('idle');
    expect(statuses.at(-1)).not.toBe('idle');
    expect(document.querySelector('style[data-et]')).not.toBeNull();
  });
});

describe('page session: errors', () => {
  it('retries a dropped connection instead of failing paragraphs', async () => {
    const { session, port, show } = setup('<p>Reconnect paragraph text.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.finish({
      status: 'error',
      error: appError('network', 'network/port-disconnected', 'gone', { retryable: true }),
    });
    await wait();
    expect(session.state().failed).toBe(0);
    expect(document.querySelector('et-tr')).toBeNull();
    await vi.waitFor(() => expect(port.calls).toHaveLength(2), { timeout: 1500 });
    expect(port.calls[1]?.payload.items[0]?.text).toBe('Reconnect paragraph text.');
    port.calls[1]?.answer();
    await vi.waitFor(() => expect(translations()).toEqual(['译:Reconnect paragraph text.']));
  });

  it('pauses on an engine problem and resumes with a one-off engine', async () => {
    const { session, port, show, statuses } = setup(
      '<p>Engine paragraph one.</p><p>Engine paragraph two.</p>',
    );
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const [first] = port.calls[0]?.payload.items ?? [];
    port.calls[0]?.onChunk?.({ id: first?.id ?? '', error: engineError('provider/unauthorized') });
    port.calls[0]?.finish({
      status: 'error',
      error: engineError('provider/unauthorized'),
    });
    await wait();
    const paused = session.state();
    expect(paused.engineError?.code).toBe('provider/unauthorized');
    expect(paused.failed).toBe(0);
    expect(statuses.at(-1)).toBe('error');
    expect(document.querySelector('et-tr')).toBeNull();
    await wait(100);
    expect(port.calls).toHaveLength(1);

    await session.start({ engine: 'google' });
    await vi.waitFor(() => expect(port.calls).toHaveLength(2));
    expect(port.calls[1]?.payload.engine).toBe('google');
    expect(port.calls[1]?.payload.items).toHaveLength(2);
    expect(session.state().engineError).toBeUndefined();
  });

  /** Pauses on an engine error, retries with the same engine, then switches while in flight. */
  async function switchWhileOldEngineInFlight(markup: string) {
    const t = setup(markup);
    await t.session.start();
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    t.port.calls[0]?.finish({ status: 'error', error: engineError('provider/unauthorized') });
    await vi.waitFor(() => expect(t.session.state().engineError).toBeDefined());
    t.session.retryFailed();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(2));
    expect(t.port.calls[1]?.payload.engine).toBeUndefined();
    await t.session.start({ engine: 'google' });
    await wait();
    // Every paragraph is still out with the old engine: nothing to send yet.
    expect(t.port.calls).toHaveLength(2);
    return { ...t, old: t.port.calls[1] as Call };
  }

  it("resends with the new engine when the old engine's request fails after a switch", async () => {
    const { session, port, old } = await switchWhileOldEngineInFlight(
      '<p>Late failure one.</p><p>Late failure two.</p>',
    );
    old.finish({ status: 'error', error: engineError('provider/unauthorized') });
    await vi.waitFor(() => expect(port.calls).toHaveLength(3));
    expect(port.calls[2]?.payload.engine).toBe('google');
    expect(port.calls[2]?.payload.items.map((item) => item.text)).toEqual([
      'Late failure one.',
      'Late failure two.',
    ]);
    expect(session.state().engineError).toBeUndefined();
  });

  it("keeps the old engine's translations and resends only its engine-level rejects", async () => {
    const { session, port, old } = await switchWhileOldEngineInFlight(
      '<p>Late chunk one.</p><p>Late chunk two.</p>',
    );
    const [first, second] = old.payload.items;
    old.onChunk?.({
      id: first?.id ?? '',
      text: '旧引擎译文',
      disposition: 'translated',
      cached: false,
    });
    old.onChunk?.({ id: second?.id ?? '', error: engineError('provider/quota-exceeded') });
    old.finish({ status: 'done', data: { total: 2, failed: 1 } });
    await vi.waitFor(() => expect(port.calls).toHaveLength(3));
    expect(port.calls[2]?.payload.engine).toBe('google');
    expect(port.calls[2]?.payload.items.map((item) => item.text)).toEqual(['Late chunk two.']);
    expect(session.state().engineError).toBeUndefined();
    await vi.waitFor(() => expect(translations()).toEqual(['旧引擎译文']));
  });

  it('still pauses on an engine error from the current engine after a switch', async () => {
    const { session, port, old } = await switchWhileOldEngineInFlight(
      '<p>Current engine one.</p><p>Current engine two.</p>',
    );
    old.finish({ status: 'error', error: engineError('provider/unauthorized') });
    await vi.waitFor(() => expect(port.calls).toHaveLength(3));
    port.calls[2]?.finish({ status: 'error', error: engineError('config/missing-key') });
    await vi.waitFor(() => expect(session.state().engineError?.code).toBe('config/missing-key'));
    await wait(100);
    expect(port.calls).toHaveLength(3);
  });

  it('marks a single paragraph failed and retries it on request', async () => {
    const { session, port, show } = setup('<p>Fails once paragraph.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const call = port.calls[0] as Call;
    call.onChunk?.({
      id: call.payload.items[0]?.id ?? '',
      error: appError('provider', 'provider/bad-response', 'bad'),
    });
    call.finish({ status: 'done', data: { total: 1, failed: 1 } });
    await vi.waitFor(() => expect(session.state().failed).toBe(1));
    await vi.waitFor(() =>
      expect(document.querySelector('et-tr[data-et-state="error"]')).not.toBeNull(),
    );
    session.retryFailed();
    await vi.waitFor(() => expect(port.calls).toHaveLength(2));
    port.calls[1]?.answer();
    await vi.waitFor(() => expect(translations()).toEqual(['译:Fails once paragraph.']));
    expect(session.state().failed).toBe(0);
  });

  it('shows the userMessage from the background on a failed paragraph, else the generic text', async () => {
    const { session, port, show } = setup('<p>First failing paragraph.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const call = port.calls[0] as Call;
    call.onChunk?.({
      id: call.payload.items[0]?.id ?? '',
      error: { ...appError('provider', 'provider/bad-request', 'bad'), userMessage: '后台文案<b>' },
    });
    call.finish({ status: 'done', data: { total: 1, failed: 1 } });
    await vi.waitFor(() =>
      expect(document.querySelector('et-tr[data-et-state="error"]')?.getAttribute('title')).toBe(
        '后台文案<b>',
      ),
    );
    expect(document.querySelector('et-tr b')).toBeNull();
    session.retryFailed();
    await vi.waitFor(() => expect(port.calls).toHaveLength(2));
    const again = port.calls[1] as Call;
    again.onChunk?.({
      id: again.payload.items[0]?.id ?? '',
      error: appError('provider', 'provider/bad-request', 'bad'),
    });
    again.finish({ status: 'done', data: { total: 1, failed: 1 } });
    await vi.waitFor(() =>
      expect(document.querySelector('et-tr[data-et-state="error"]')?.getAttribute('title')).toBe(
        '操作失败，请重试。',
      ),
    );
  });

  it('splits a batch the background found too large', async () => {
    const { session, port, show } = setup('<p>Split paragraph one.</p><p>Split paragraph two.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.finish({
      status: 'error',
      error: appError('validation', 'validation/payload-too-large', 'too big'),
    });
    await vi.waitFor(() => expect(port.calls).toHaveLength(3));
    expect(port.calls.slice(1).map((call) => call.payload.items.length)).toEqual([1, 1]);
  });

  it('halts quietly when the extension context is gone, keeping the translations', async () => {
    const { session, port, show, statuses } = setup(
      '<p>Halt paragraph one.</p><div><p>Halt paragraph two.</p></div>',
    );
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const call = port.calls[0] as Call;
    const [first] = call.payload.items;
    call.onChunk?.({
      id: first?.id ?? '',
      text: '第一段',
      disposition: 'translated',
      cached: false,
    });
    await vi.waitFor(() => expect(translations()).toEqual(['第一段']));
    const reported = statuses.length;
    call.finish({
      status: 'error',
      error: appError('internal', 'internal/context-invalidated', 'gone'),
    });
    await wait();
    document.querySelector('div')?.append(document.createElement('p'));
    await wait();
    expect(translations()).toEqual(['第一段']);
    expect(port.calls).toHaveLength(1);
    expect(statuses).toHaveLength(reported);
    expect((await session.start()).phase).not.toBe('idle');
    expect(port.calls).toHaveLength(1);
  });

  it('classifies engine-level errors', () => {
    expect(isEngineLevel(engineError('config/missing-key'))).toBe(true);
    expect(isEngineLevel(engineError('provider/quota-exceeded'))).toBe(true);
    expect(isEngineLevel(engineError('provider/local-origin-rejected'))).toBe(true);
    expect(isEngineLevel(engineError('provider/rate-limited'))).toBe(false);
    expect(isEngineLevel(appError('network', 'network/timeout', 't'))).toBe(false);
  });
});

describe('page session: paragraphs waiting to retry', () => {
  const texts = Array.from({ length: 51 }, (_, i) => `Waiting paragraph ${i} text.`);
  const many = texts.map((text) => `<p>${text}</p>`).join('');
  const disconnected = () =>
    appError('network', 'network/port-disconnected', 'gone', { retryable: true });
  const textsOf = (calls: Call[]) => calls.flatMap((call) => call.payload.items.map((i) => i.text));

  /** 51 paragraphs make two requests: A (50) drops its connection and waits to retry. */
  async function twoBatches() {
    const t = setup(many);
    await t.session.start();
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(2));
    const [a, b] = t.port.calls as [Call, Call];
    expect(a.payload.items).toHaveLength(50);
    a.finish({ status: 'error', error: disconnected() });
    await wait(10);
    return { ...t, a, b };
  }

  /** B answers each paragraph with an engine-level error: the session pauses. */
  function pauseByChunk(b: Call) {
    for (const item of b.payload.items) {
      b.onChunk?.({ id: item.id, error: engineError('provider/unauthorized') });
    }
    b.finish({ status: 'done', data: { total: b.payload.items.length, failed: 1 } });
  }

  /** B fails as a whole request with an engine-level error: the session pauses. */
  function pauseByRequest(b: Call) {
    b.finish({ status: 'error', error: engineError('provider/unauthorized') });
  }

  /** Pauses the session, then lets A's retry timer (500ms) fire while paused. */
  async function pauseThroughTimer(
    t: Awaited<ReturnType<typeof twoBatches>>,
    pause: typeof pauseByChunk,
  ) {
    pause(t.b);
    await vi.waitFor(() => expect(t.session.state().engineError).toBeDefined());
    await wait(600);
    expect(t.port.calls).toHaveLength(2);
  }

  it('resends the waiting paragraphs after a one-off engine switch (per-paragraph engine error)', async () => {
    const t = await twoBatches();
    await pauseThroughTimer(t, pauseByChunk);
    await t.session.start({ engine: 'google' });
    await vi.waitFor(() => expect(textsOf(t.port.calls.slice(2))).toHaveLength(51));
    expect([...textsOf(t.port.calls.slice(2))].sort()).toEqual([...texts].sort());
    expect(t.port.calls.slice(2).every((call) => call.payload.engine === 'google')).toBe(true);
  });

  it('resends the waiting paragraphs after a one-off engine switch (request-level engine error)', async () => {
    const t = await twoBatches();
    await pauseThroughTimer(t, pauseByRequest);
    await t.session.start({ engine: 'google' });
    await vi.waitFor(() => expect(textsOf(t.port.calls.slice(2))).toHaveLength(51));
    expect([...textsOf(t.port.calls.slice(2))].sort()).toEqual([...texts].sort());
  });

  it('resends the waiting paragraphs on retryFailed', async () => {
    const t = await twoBatches();
    await pauseThroughTimer(t, pauseByChunk);
    t.session.retryFailed();
    await vi.waitFor(() => expect(textsOf(t.port.calls.slice(2))).toHaveLength(51));
    expect([...textsOf(t.port.calls.slice(2))].sort()).toEqual([...texts].sort());
    expect(t.session.state().engineError).toBeUndefined();
  });

  it('puts back only the waiting paragraphs still in range; the rest queue when seen again', async () => {
    const t = await twoBatches();
    // The first ten of A's paragraphs leave the 1000px range while they wait.
    const away = t.observed.slice(0, 10);
    const awayTexts = texts.slice(0, 10);
    t.hide(away);
    await pauseThroughTimer(t, pauseByChunk);
    await t.session.start({ engine: 'google' });
    await vi.waitFor(() => expect(textsOf(t.port.calls.slice(2))).toHaveLength(41));
    await wait(100);
    const resent = textsOf(t.port.calls.slice(2));
    expect(resent).toHaveLength(41);
    expect(resent.filter((text) => awayTexts.includes(text))).toEqual([]);
    const before = t.port.calls.length;
    t.show(away);
    await vi.waitFor(() =>
      expect([...textsOf(t.port.calls.slice(before))].sort()).toEqual([...awayTexts].sort()),
    );
  });

  it('starts the backoff over for paragraphs put back after a pause', async () => {
    const t = await twoBatches();
    await pauseThroughTimer(t, pauseByChunk);
    await t.session.start({ engine: 'google' });
    await vi.waitFor(() => expect(textsOf(t.port.calls.slice(2))).toHaveLength(51));
    const resent = t.port.calls.slice(2);
    // Attempt 0 again: the same paragraphs wait 500ms (not 1s) and are not marked failed.
    for (const call of resent) call.finish({ status: 'error', error: disconnected() });
    await wait(100);
    expect(t.port.calls).toHaveLength(2 + resent.length);
    await vi.waitFor(
      () => expect(textsOf(t.port.calls.slice(2 + resent.length))).toHaveLength(51),
      {
        timeout: 750,
      },
    );
    expect(t.session.state().failed).toBe(0);
  });

  it('never resends a paragraph forgotten while it waited, nor gives it a new id', async () => {
    const { session, port, show, unobserved } = setup(
      '<div><p>Kept waiting text.</p><p id="gone">Removed waiting text.</p></div>',
    );
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const original = port.calls[0] as Call;
    original.finish({ status: 'error', error: disconnected() });
    const gone = document.getElementById('gone') as HTMLElement;
    gone.remove();
    await vi.waitFor(() => expect(unobserved).toContain(gone));
    await vi.waitFor(() => expect(port.calls).toHaveLength(2), { timeout: 1500 });
    await wait(100);
    expect(port.calls).toHaveLength(2);
    const kept = original.payload.items.find((item) => item.text === 'Kept waiting text.');
    expect(port.calls[1]?.payload.items).toEqual([kept]);
  });

  it('does not send a waiting paragraph twice when the viewport reports it again', async () => {
    const { session, port, show, sentTexts } = setup('<p>Seen twice waiting text.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.finish({ status: 'error', error: disconnected() });
    await wait(10);
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(2), { timeout: 1500 });
    // Past the 500ms retry timer: one resend in all, whichever path sent it.
    await wait(600);
    expect(sentTexts()).toEqual(['Seen twice waiting text.', 'Seen twice waiting text.']);
  });

  it('sends nothing after stop when the retry timer fires', async () => {
    const { session, port, show } = setup('<p>Stopped waiting text.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.finish({ status: 'error', error: disconnected() });
    await wait(10);
    await session.stop();
    await wait(600);
    expect(port.calls).toHaveLength(1);
  });

  it('reports running, not done, while paragraphs wait to retry', async () => {
    const { session, port, show, statuses } = setup('<p>Still running waiting text.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.finish({ status: 'error', error: disconnected() });
    await wait(10);
    expect(session.state().phase).toBe('running');
    expect(statuses.at(-1)).toBe('running');
    await vi.waitFor(() => expect(port.calls).toHaveLength(2), { timeout: 1500 });
    port.calls[1]?.answer();
    await vi.waitFor(() => expect(session.state().phase).toBe('done'));
    expect(statuses.at(-1)).toBe('done');
  });
});

describe('page session: dynamic content', () => {
  it('translates paragraphs the page adds later', async () => {
    const { session, port, show, sentTexts } = setup(
      '<div id="feed"><p>Existing post text.</p></div>',
    );
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    const added = document.createElement('p');
    added.textContent = 'A newly loaded post.';
    document.getElementById('feed')?.append(added);
    await wait();
    show([added]);
    await vi.waitFor(() => expect(sentTexts()).toContain('A newly loaded post.'));
  });

  it('replaces a translation when the page edits the paragraph', async () => {
    const { session, port, show, sentTexts } = setup('<p id="live">Score is one to nil.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    const live = document.getElementById('live') as HTMLElement;
    (live.firstChild as Text).nodeValue = 'Score is two to nil.';
    await vi.waitFor(() => expect(translations()).toHaveLength(0));
    show([live]);
    await vi.waitFor(() => expect(sentTexts()).toContain('Score is two to nil.'));
    port.calls.at(-1)?.answer();
    await vi.waitFor(() => expect(translations()).toEqual(['译:Score is two to nil.']));
  });

  it('keeps translations while a dialog marks the page aria-hidden', async () => {
    const { session, port, show } = setup('<main><p>Behind the dialog text.</p></main>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    const shown = document.querySelector('et-tr');
    const main = document.querySelector('main') as HTMLElement;
    main.setAttribute('aria-hidden', 'true');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    await wait(100);
    // The same node: never dropped and re-inserted (a flash, and a strike toward the loop guard).
    expect(document.querySelector('et-tr')).toBe(shown);
    dialog.remove();
    main.removeAttribute('aria-hidden');
    await wait(100);
    expect(translations()).toEqual(['译:Behind the dialog text.']);
    expect(port.calls).toHaveLength(1);
  });

  it('keeps one translation when a mixed parent loses its block child', async () => {
    const { session, port, show } = setup(
      '<div id="host">Inline lead text here. <div id="inner"><p>Block child text.</p></div></div>',
    );
    await session.start();
    show([document.getElementById('host') as HTMLElement]);
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    document.getElementById('inner')?.remove();
    await wait(150);
    expect(translations()).toEqual(['译:Inline lead text here.']);
  });

  it('forgets units whose whole area left before they were translated', async () => {
    const { session, show, observed, unobserved } = setup(
      '<section id="feed"><p>Never shown post text.</p></section><div><p>Other text here.</p></div>',
    );
    await session.start();
    show(observed.slice(1));
    const feed = document.getElementById('feed') as HTMLElement;
    const paragraph = feed.querySelector('p') as HTMLElement;
    feed.remove();
    document.body.append(document.createElement('div'));
    await vi.waitFor(() => expect(unobserved).toContain(paragraph));
  });

  it('lets go of paragraphs the page removed', async () => {
    const { session, port, show, unobserved } = setup(
      '<div><p id="gone">Soon removed text.</p></div>',
    );
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    const gone = document.getElementById('gone') as HTMLElement;
    gone.remove();
    await vi.waitFor(() => expect(unobserved).toContain(gone));
    expect(session.state().translated).toBe(0);
  });

  it('puts back a translation a framework removed, but gives up after three times', async () => {
    const { session, port, show } = setup('<p id="x">Framework fights here.</p>');
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let round = 0; round < 3; round += 1) {
      document.querySelector('et-tr')?.remove();
      await vi.waitFor(() => expect(translations()).toHaveLength(1));
    }
    document.querySelector('et-tr')?.remove();
    await wait(100);
    expect(translations()).toHaveLength(0);
    expect(port.calls).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('processes a huge first viewport callback in slices', async () => {
    const markup = Array.from({ length: 1200 }, (_, i) => `<p>Paragraph number ${i} text.</p>`);
    const { session, port, show, sentTexts } = setup(markup.join(''));
    await session.start();
    show();
    await vi.waitFor(() => expect(sentTexts()).toHaveLength(300), { timeout: 3000 });
    expect(port.calls).toHaveLength(6);
    for (const call of port.calls) call.answer();
    await vi.waitFor(() => expect(sentTexts()).toHaveLength(600), { timeout: 3000 });
  });
});

describe('page session: subscribe', () => {
  it('pushes the current state once per frame and coalesces a burst', async () => {
    const { session, runFrame, queuedFrames } = setup('<p>Subscribe burst text.</p>');
    const seen: string[] = [];
    session.subscribe((state) => seen.push(state.phase));
    await session.start();
    expect(queuedFrames()).toBe(1);
    expect(seen).toEqual([]);
    runFrame();
    expect(seen).toEqual(['running']);
    runFrame();
    expect(seen).toEqual(['running']);
  });

  it('pushes the configured mode as soon as the session has it', async () => {
    const config = createDefaultConfig('zh-CN');
    config.page.mode = 'translation';
    const { session, runFrame, queuedFrames } = setup('<p>Mode push text.</p>', async () => config);
    const seen: string[] = [];
    session.subscribe((state) => seen.push(state.mode));
    const started = session.start();
    runFrame();
    // Before the config is read the mode can only be the default.
    expect(seen).toEqual(['bilingual']);
    await started;
    // No report has run yet (nothing was shown): this push comes from start itself.
    expect(queuedFrames()).toBe(1);
    runFrame();
    expect(seen).toEqual(['bilingual', 'translation']);
  });

  it('does not queue a frame without subscribers', async () => {
    const { session, queuedFrames } = setup('<p>No subscriber text.</p>');
    await session.start();
    expect(queuedFrames()).toBe(0);
  });

  it('pushes after begin, report (translations arriving), setMode, retryFailed and stop', async () => {
    const { session, port, show, runFrame } = setup('<p>Call site paragraph.</p>');
    const seen: { phase: string; translated: number; mode: string; failed: number }[] = [];
    session.subscribe(({ phase, translated, mode, failed }) =>
      seen.push({ phase, translated, mode, failed }),
    );
    await session.start();
    runFrame();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    await vi.waitFor(() => expect(session.state().phase).toBe('done'));
    seen.length = 0;
    runFrame();
    expect(seen.at(-1)).toMatchObject({ phase: 'done', translated: 1 });

    seen.length = 0;
    await session.setMode('translation');
    runFrame();
    expect(seen).toEqual([{ phase: 'done', translated: 1, mode: 'translation', failed: 0 }]);

    seen.length = 0;
    session.retryFailed();
    runFrame();
    expect(seen).toHaveLength(1);

    seen.length = 0;
    await session.stop();
    runFrame();
    expect(seen.at(-1)).toMatchObject({ phase: 'idle', translated: 0 });
  });

  it('pushes when failures are recorded and when an engine error pauses the session', async () => {
    const { session, port, show, runFrame } = setup('<p>Failure push text.</p>');
    const seen: { failed: number; error: boolean }[] = [];
    session.subscribe(({ failed, engineError: error }) =>
      seen.push({ failed, error: error !== undefined }),
    );
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const [item] = port.calls[0]?.payload.items ?? [];
    port.calls[0]?.onChunk?.({ id: item?.id ?? '', error: engineError('config/missing-key') });
    await vi.waitFor(() => expect(session.state().engineError).toBeDefined());
    runFrame();
    expect(seen.at(-1)).toEqual({ failed: 0, error: true });
    seen.length = 0;
    session.retryFailed();
    runFrame();
    expect(seen.at(-1)).toEqual({ failed: 0, error: false });
  });

  it('pushes when the engine of a running session is switched', async () => {
    const { session, runFrame } = setup('<p>Switch engine text.</p>');
    await session.start();
    const seen: (string | undefined)[] = [];
    session.subscribe((state) => seen.push(state.engine));
    runFrame();
    await session.start({ engine: 'deepseek' });
    runFrame();
    expect(seen).toEqual(['deepseek']);
  });

  it('stops pushing after unsubscribe and cancels the queued frame', async () => {
    const { session, runFrame, queuedFrames } = setup('<p>Unsubscribe text.</p>');
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    await session.start();
    expect(queuedFrames()).toBe(1);
    unsubscribe();
    expect(queuedFrames()).toBe(0);
    runFrame();
    expect(listener).not.toHaveBeenCalled();
    await session.stop();
    runFrame();
    expect(listener).not.toHaveBeenCalled();
  });

  it('pushes on halt with halted set, and not before', async () => {
    const { session, port, show, runFrame, queuedFrames } = setup('<p>Halt push text.</p>');
    const seen: (true | undefined)[] = [];
    session.subscribe((state) => seen.push(state.halted));
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    await wait();
    runFrame();
    expect(queuedFrames()).toBe(0);
    expect(session.state()).not.toHaveProperty('halted');
    seen.length = 0;
    port.calls[0]?.finish({
      status: 'error',
      error: appError('internal', 'internal/context-invalidated', 'gone'),
    });
    await vi.waitFor(() => expect(session.state().halted).toBe(true));
    await wait();
    // The halted session reports nothing more: this push is halt's own.
    runFrame();
    expect(seen).toEqual([true]);
  });

  it('keeps an isle host out of translation and of rescans, even when a page moves it into the body', async () => {
    const { session, show, port, dirtyRounds } = setup('<p>Host skip paragraph.</p>');
    const before = document.createElement('et-isle');
    before.textContent = 'Isle light text';
    document.body.append(before);
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const sent = port.calls.flatMap((call) => call.payload.items.map((item) => item.text));
    expect(sent.join(' ')).not.toContain('Isle');
    await wait(30);
    dirtyRounds.length = 0;
    // The isle mounts under <html>; a page that moves it into the watched body, or
    // touches its light DOM there, must not cost a rescan.
    const host = document.createElement('et-isle');
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>Isle inner text</p>';
    document.body.append(host);
    await wait(30);
    host.append(document.createElement('p'));
    await wait();
    expect(dirtyRounds).toEqual([]);
    expect(port.calls).toHaveLength(1);
  });

  it('keeps a selection card host out of translation, even inside the body', async () => {
    const { session, show, port } = setup('<p>Card skip paragraph.</p>');
    const card = document.createElement('et-selection');
    card.textContent = 'Selection card text';
    document.body.append(card);
    await session.start();
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    const sent = port.calls.flatMap((call) => call.payload.items.map((item) => item.text));
    expect(sent.join(' ')).not.toContain('Selection card');
    await wait(30);
    // A node inside the host is ours too: no rescan.
    card.append(document.createElement('p'));
    await wait();
    expect(port.calls).toHaveLength(1);
  });
});
