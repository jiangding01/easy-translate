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
import { type MutationWatchOptions, watchMutations } from './mutations';
import { IDLE_PAGE_STATE } from './runtime-contract';
import { createPageSession, isEngineLevel, type SessionDeps } from './session';

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

function setup(
  markup: string,
  getConfig = async () => createDefaultConfig('zh-CN'),
  extra: Partial<SessionDeps> = {},
) {
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
      return () => {
        const at = configListeners.indexOf(callback);
        if (at >= 0) configListeners.splice(at, 1);
      };
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
    ...extra,
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

  it('keeps the engine it started with when the default engine changes mid-session', async () => {
    const { session, port, show, observed, configListeners } = setup(
      '<p>First pinned paragraph.</p><p>Second pinned paragraph.</p>',
    );
    await session.start();
    show(observed.slice(0, 1));
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    expect(port.calls[0]?.payload.engine).toBe('google');
    port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    const next = createDefaultConfig('zh-CN');
    next.translation.engine = 'deepseek';
    for (const listener of configListeners) listener(next);
    show(observed.slice(1));
    await vi.waitFor(() => expect(port.calls).toHaveLength(2));
    expect(port.calls[1]?.payload.engine).toBe('google');
    expect(session.state().engine).toBe('google');
  });

  it('keeps an engine picked while the config is still loading', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { session, port, show } = setup('<p>Picked during load.</p>', async () => {
      await gate;
      return createDefaultConfig('zh-CN');
    });
    const started = session.start();
    await wait();
    await session.start({ engine: 'deepseek' });
    release();
    await started;
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    expect(port.calls[0]?.payload.engine).toBe('deepseek');
    expect(session.state().engine).toBe('deepseek');
  });

  it('starts with the given engine, and re-pins the then-current default after a stop', async () => {
    const config = createDefaultConfig('zh-CN');
    const { session, port, show } = setup('<p>Pinned after stop.</p>', async () => config);
    await session.start({ engine: 'deepseek' });
    expect(session.state().engine).toBe('deepseek');
    await session.stop();
    expect(session.state().engine).toBeUndefined();
    config.translation.engine = 'gemini';
    await session.start();
    expect(session.state().engine).toBe('gemini');
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    expect(port.calls[0]?.payload.engine).toBe('gemini');
  });

  it('pauses when the pinned engine no longer exists (deleted custom engine)', async () => {
    const { session, port, show } = setup('<p>Deleted engine paragraph.</p>');
    await session.start({ engine: 'custom-gone' as never });
    show();
    await vi.waitFor(() => expect(port.calls).toHaveLength(1));
    expect(port.calls[0]?.payload.engine).toBe('custom-gone');
    port.calls[0]?.finish({
      status: 'error',
      error: appError('config', 'config/provider-missing', 'Custom provider not found'),
    });
    await vi.waitFor(() =>
      expect(session.state().engineError?.code).toBe('config/provider-missing'),
    );
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
    expect(t.port.calls[1]?.payload.engine).toBe('google');
    await t.session.start({ engine: 'deepseek' });
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
    expect(port.calls[2]?.payload.engine).toBe('deepseek');
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
    expect(port.calls[2]?.payload.engine).toBe('deepseek');
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

  it('halts at its next notification once the extension is unreachable, keeping the translations', async () => {
    let alive = true;
    const { session, port, show, runFrame } = setup(
      '<p>Gone paragraph one.</p><div><p>Gone paragraph two.</p></div>',
      undefined,
      {
        alive: () => alive,
        // Its unsubscribe needs the extension, like the real one's `storage.onChanged`.
        watchConfig: () => () => {
          throw new Error('Extension context invalidated.');
        },
      },
    );
    const seen: (true | undefined)[] = [];
    session.subscribe((state) => seen.push(state.halted));
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
    runFrame();
    expect(session.state()).not.toHaveProperty('halted');

    // The isle's own actions end up here; no request error has told the session anything.
    alive = false;
    session.retryFailed();
    expect(session.state().halted).toBe(true);
    seen.length = 0;
    runFrame();
    expect(seen).toEqual([true]);
    document.querySelector('div')?.append(document.createElement('p'));
    await wait();
    expect(translations()).toEqual(['第一段']);
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

describe('page session: loading dots', () => {
  /** Short delay and scan interval; `near` is what counts as inside the real viewport. */
  function loadingSetup(markup: string, loadingDelayMs = 80) {
    const near = new Set<Element>();
    const t = setup(markup, undefined, {
      loadingDelayMs,
      loadingScanMs: 20,
      inViewport: (el) => near.has(el),
    });
    return { ...t, near };
  }
  const dots = () => document.querySelectorAll('et-tr[data-et-state="loading"]').length;
  const para = (id: string) => document.getElementById(id) as HTMLElement;
  const idOf = (call: Call, index: number) => call.payload.items[index]?.id ?? '';
  const answerItem = (call: Call, index: number, text: string) =>
    call.onChunk?.({ id: idOf(call, index), text, disposition: 'translated', cached: false });
  /** Records every loading dot the page gets added or loses, for "never appeared" checks. */
  function watchDots() {
    const added: Node[] = [];
    const removed: Node[] = [];
    const isDot = (node: Node) => (node as Element).getAttribute?.('data-et-state') === 'loading';
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (isDot(node)) added.push(node);
        for (const node of record.removedNodes) if (isDot(node)) removed.push(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return { added, removed, stop: () => observer.disconnect() };
  }

  it('shows a dot for a waiting paragraph in the viewport, then swaps it for the translation; one only in the prefetch margin gets none', async () => {
    const t = loadingSetup('<p id="a">Inside the viewport.</p><p id="b">Only in the margin.</p>');
    await t.session.start();
    t.near.add(para('a'));
    t.show();
    const seen = watchDots();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    await vi.waitFor(() => expect(dots()).toBe(1));
    expect(para('a').querySelector('et-tr[data-et-state="loading"]')).not.toBeNull();
    await wait(150);
    seen.stop();
    // Never added, not merely absent at the end.
    expect(seen.added.some((node) => para('b').contains(node))).toBe(false);
    expect(para('b').querySelector('et-tr')).toBeNull();
    t.port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(2));
    expect(dots()).toBe(0);
    expect(para('a').querySelectorAll('et-tr')).toHaveLength(1);
  });

  it('never shows a dot when the reply comes before the delay', async () => {
    const t = loadingSetup('<p id="a">Fast reply paragraph.</p>');
    await t.session.start();
    t.near.add(para('a'));
    const seen = watchDots();
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    t.port.calls[0]?.answer();
    await vi.waitFor(() => expect(translations()).toHaveLength(1));
    await wait(200);
    seen.stop();
    expect(seen.added).toEqual([]);
    expect(dots()).toBe(0);
  });

  it('takes the dot away when a paragraph is given up on, fails, or is forgotten', async () => {
    const t = loadingSetup(
      '<p id="a">Skipped paragraph one.</p><p id="b">Failing paragraph two.</p><p id="c">Edited paragraph three.</p>',
    );
    await t.session.start();
    for (const id of ['a', 'b', 'c']) t.near.add(para(id));
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    await vi.waitFor(() => expect(dots()).toBe(3));
    const call = t.port.calls[0] as Call;
    const seen = watchDots();
    // Not translated (the text is already in the target language): the dot just goes.
    call.onChunk?.({ id: idOf(call, 0), text: 'x', disposition: 'same-language', cached: false });
    await vi.waitFor(() => expect(dots()).toBe(2));
    expect(para('a').querySelector('et-tr')).toBeNull();
    // Failed: the retry note takes its place.
    call.onChunk?.({
      id: idOf(call, 1),
      error: appError('provider', 'provider/bad-response', 'bad'),
    });
    await vi.waitFor(() =>
      expect(para('b').querySelector('et-tr[data-et-state="error"]')).not.toBeNull(),
    );
    expect(para('b').querySelector('et-tr[data-et-state="loading"]')).toBeNull();
    // Forgotten: the page changed the text, the old unit and its dot go.
    const dotOfC = para('c').querySelector('et-tr[data-et-state="loading"]');
    (para('c').firstChild as Text).nodeValue = 'Edited paragraph three, again.';
    await vi.waitFor(() => expect(seen.removed).toContain(dotOfC));
    seen.stop();
  });

  it('takes the dot away when the paragraph leaves the viewport or the session stops', async () => {
    const t = loadingSetup('<p id="a">Scrolled away paragraph.</p>');
    await t.session.start();
    t.near.add(para('a'));
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    await vi.waitFor(() => expect(dots()).toBe(1));
    t.near.delete(para('a'));
    await vi.waitFor(() => expect(dots()).toBe(0));
    t.near.add(para('a'));
    await vi.waitFor(() => expect(dots()).toBe(1));
    const seen = watchDots();
    await t.session.stop();
    await wait(120);
    seen.stop();
    expect(seen.added).toEqual([]);
    expect(dots()).toBe(0);
    expect(document.body.innerHTML).toBe(t.before);
  });

  it('takes the dot away when a waiting paragraph is moved out of the queue by the viewport', async () => {
    const t = loadingSetup('<p id="a">Queued then scrolled past.</p>', 40);
    await t.session.start();
    t.near.add(para('a'));
    // A scroll in progress keeps paragraphs queued instead of sending them.
    window.dispatchEvent(new Event('scroll'));
    t.show();
    await vi.waitFor(() => expect(dots()).toBe(1));
    expect(t.port.calls).toHaveLength(0);
    t.hide([para('a')]);
    await vi.waitFor(() => expect(dots()).toBe(0));
  });

  it('hides every dot on an engine error, shows none while paused, and brings them back on resume', async () => {
    const t = loadingSetup(
      '<p id="a">Paused paragraph one.</p><p id="b">Paused paragraph two.</p>',
    );
    await t.session.start();
    t.near.add(para('a'));
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    await vi.waitFor(() => expect(dots()).toBe(1));
    const call = t.port.calls[0] as Call;
    call.onChunk?.({ id: idOf(call, 0), error: engineError('provider/unauthorized') });
    await vi.waitFor(() => expect(t.session.state().engineError).toBeDefined());
    expect(dots()).toBe(0);
    const seen = watchDots();
    await wait(200);
    seen.stop();
    expect(seen.added).toEqual([]);
    // Resume: the paragraphs have waited long already, so the dot is back at once.
    await t.session.start({ engine: 'google' });
    await vi.waitFor(() => expect(dots()).toBe(1));
    expect(t.port.calls).toHaveLength(2);
    t.port.calls[1]?.answer();
    await vi.waitFor(() => expect(translations()).toEqual(['译:Paused paragraph one.']));
    expect(dots()).toBe(0);
  });

  it('swapping a dot for the translation is not a page change; a page removal still is', async () => {
    const t = loadingSetup('<p id="a">Swapped paragraph text.</p>', 40);
    await t.session.start();
    t.near.add(para('a'));
    t.show();
    await vi.waitFor(() => expect(dots()).toBe(1));
    answerItem(t.port.calls[0] as Call, 0, '译:换');
    await vi.waitFor(() => expect(translations()).toEqual(['译:换']));
    await wait(100);
    expect(dots()).toBe(0);
    expect(t.dirtyRounds).toEqual([]);
    para('a').append(document.createElement('span'));
    para('a').lastElementChild?.remove();
    await vi.waitFor(() => expect(t.dirtyRounds.length).toBeGreaterThan(0));
  });

  /** Two paragraphs in one request; the request then ends because the extension went away. */
  async function haltSetup() {
    const t = loadingSetup(
      '<p id="a">Halted paragraph one.</p><p id="b">Halted paragraph two.</p>',
    );
    await t.session.start();
    t.near.add(para('a'));
    t.near.add(para('b'));
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    await vi.waitFor(() => expect(dots()).toBe(2));
    const call = t.port.calls[0] as Call;
    const invalidated = () =>
      call.finish({
        status: 'error',
        error: appError('internal', 'internal/context-invalidated', 'gone'),
      });
    return { t, call, invalidated };
  }

  it('takes every dot away when the session halts, and none comes back', async () => {
    const { t, invalidated } = await haltSetup();
    invalidated();
    await vi.waitFor(() => expect(t.session.state().halted).toBe(true));
    expect(dots()).toBe(0);
    const seen = watchDots();
    await wait(200);
    seen.stop();
    expect(seen.added).toEqual([]);
    expect(dots()).toBe(0);
  });

  it('halting after a reply but before its render leaves no dot behind', async () => {
    const { t, call, invalidated } = await haltSetup();
    answerItem(call, 0, '译:未渲染');
    invalidated();
    await vi.waitFor(() => expect(t.session.state().halted).toBe(true));
    await wait(100);
    expect(dots()).toBe(0);
    expect(translations()).toEqual([]);
  });

  it('retry after a halt leaves the failure note alone, shows no dot and sends nothing', async () => {
    const t = loadingSetup(
      '<p id="a">Failed then halted.</p><p id="b">Never answered one.</p>',
      60_000,
    );
    await t.session.start();
    t.near.add(para('a'));
    t.near.add(para('b'));
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    const call = t.port.calls[0] as Call;
    call.onChunk?.({
      id: idOf(call, 0),
      error: appError('provider', 'provider/bad-response', 'bad'),
    });
    await vi.waitFor(() =>
      expect(para('a').querySelector('et-tr[data-et-state="error"] button')).not.toBeNull(),
    );
    call.finish({
      status: 'error',
      error: appError('internal', 'internal/context-invalidated', 'gone'),
    });
    await vi.waitFor(() => expect(t.session.state().halted).toBe(true));
    const seen = watchDots();
    (para('a').querySelector('et-tr[data-et-state="error"] button') as HTMLElement).click();
    await wait(150);
    seen.stop();
    expect(seen.added).toEqual([]);
    expect(dots()).toBe(0);
    expect(para('a').querySelector('et-tr[data-et-state="error"]')).not.toBeNull();
    expect(t.port.calls).toHaveLength(1);
  });

  it('shows no dot for a retry pressed while the engine is paused, and one once it resumes', async () => {
    const t = loadingSetup(
      '<p id="a">Failed paragraph one.</p><p id="b">Paused paragraph two.</p>',
      100,
    );
    await t.session.start();
    t.near.add(para('a'));
    t.near.add(para('b'));
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    const call = t.port.calls[0] as Call;
    call.onChunk?.({
      id: idOf(call, 0),
      error: appError('provider', 'provider/bad-response', 'bad'),
    });
    await vi.waitFor(() =>
      expect(para('a').querySelector('et-tr[data-et-state="error"] button')).not.toBeNull(),
    );
    call.onChunk?.({ id: idOf(call, 1), error: engineError('provider/unauthorized') });
    await vi.waitFor(() => expect(t.session.state().engineError).toBeDefined());
    const seen = watchDots();
    (para('a').querySelector('et-tr[data-et-state="error"] button') as HTMLElement).click();
    await wait(150);
    expect(seen.added).toEqual([]);
    expect(dots()).toBe(0);
    // Resume: the paragraph has waited longer than the delay, so its dot is back at once.
    await t.session.start({ engine: 'google' });
    await vi.waitFor(() => expect(dots()).toBe(2));
    seen.stop();
  });

  it('stops scanning once a finished request left nothing unfinished', async () => {
    const t = loadingSetup(
      '<p id="a">Answered paragraph.</p><p id="b">Left unanswered.</p>',
      60_000,
    );
    await t.session.start();
    t.near.add(para('a'));
    t.near.add(para('b'));
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    const call = t.port.calls[0] as Call;
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const scans = () => spy.mock.calls.filter((args) => args[1] === 20).length;
    try {
      answerItem(call, 0, '译:已答');
      call.finish({ status: 'done', data: { total: 2, failed: 0 } });
      await vi.waitFor(() => expect(translations()).toEqual(['译:已答']));
      await wait(80);
      const settled = scans();
      await wait(150);
      expect(scans()).toBe(settled);
    } finally {
      spy.mockRestore();
    }
  });

  it('shows the dot at once on retry, replaces it with the translation, and keeps the paragraph through a page change', async () => {
    // A delay far beyond the test: the dot can only come from the retry itself.
    const t = loadingSetup('<p id="a">Retried paragraph text.</p>', 60_000);
    await t.session.start();
    t.near.add(para('a'));
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    const first = t.port.calls[0] as Call;
    first.onChunk?.({
      id: idOf(first, 0),
      error: appError('provider', 'provider/bad-response', 'bad'),
    });
    first.finish({ status: 'done', data: { total: 1, failed: 1 } });
    await vi.waitFor(() =>
      expect(document.querySelector('et-tr[data-et-state="error"]')).not.toBeNull(),
    );
    t.session.retryFailed();
    await vi.waitFor(() => expect(dots()).toBe(1));
    expect(document.querySelector('et-tr[data-et-state="error"]')).toBeNull();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(2));
    // A page change meanwhile: the paragraph is neither lost nor given up on.
    document.body.append(document.createElement('div'));
    await vi.waitFor(() => expect(t.dirtyRounds.length).toBeGreaterThan(0));
    await wait(100);
    expect(dots()).toBe(1);
    expect(t.port.calls).toHaveLength(2);
    answerItem(t.port.calls[1] as Call, 0, '译:重试');
    await vi.waitFor(() => expect(translations()).toEqual(['译:重试']));
    expect(dots()).toBe(0);
    expect(t.session.state()).toMatchObject({ translated: 1, failed: 0 });
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

  describe('protected areas', () => {
    const FEED = '<div id="feed"><p>Existing post text.</p></div>';

    async function started(markup: string) {
      const ctx = setup(`${FEED}${markup}`);
      await ctx.session.start();
      ctx.show();
      await vi.waitFor(() => expect(ctx.port.calls).toHaveLength(1));
      ctx.port.calls[0]?.answer();
      await vi.waitFor(() => expect(translations().length).toBeGreaterThan(0));
      await wait();
      return ctx;
    }

    /** Adds a control paragraph outside the protected area, in the same round as the change. */
    function addControl(text: string) {
      const control = document.createElement('p');
      control.textContent = text;
      document.getElementById('feed')?.append(control);
    }

    /** The control got translated (so the rescan ran) while the draft was never sent. */
    async function expectDraftBlocked(
      ctx: Awaited<ReturnType<typeof started>>,
      control: string,
      draft: string,
      draftEl: Element,
    ) {
      await wait();
      ctx.show();
      await vi.waitFor(() => expect(ctx.sentTexts()).toContain(control));
      await wait();
      expect(ctx.sentTexts().filter((text) => text.includes(draft))).toEqual([]);
      expect(ctx.observed.filter((el) => draftEl.contains(el))).toEqual([]);
    }

    it('(a) ignores a change to the protected element itself', async () => {
      const ctx = await started('<div id="ed" contenteditable="true">Original draft words.</div>');
      const editor = document.getElementById('ed') as HTMLElement;
      (editor.firstChild as Text).data = 'Alpha draft typed words.';
      addControl('Control paragraph alpha.');
      await expectDraftBlocked(ctx, 'Control paragraph alpha.', 'Alpha draft', editor);
      expect(ctx.dirtyRounds.flat()).toContain(editor);
    });

    it('(b) ignores a paragraph added inside an editor', async () => {
      const ctx = await started('<div id="ed" contenteditable="true"><p>Original line.</p></div>');
      const editor = document.getElementById('ed') as HTMLElement;
      const typed = document.createElement('p');
      typed.textContent = 'Bravo typed paragraph.';
      editor.append(typed);
      addControl('Control paragraph bravo.');
      await expectDraftBlocked(ctx, 'Control paragraph bravo.', 'Bravo typed', editor);
      expect(ctx.dirtyRounds.flat()).toContain(editor);
    });

    it('(c) ignores typing in editable spans inside a paragraph', async () => {
      // The inline span is climbed to its paragraph, which drops it from the unit; the
      // block-styled one stays its own root, so only the ancestor check keeps it out.
      const ctx = await started(
        '<p id="line">Lead text here <span id="inl" contenteditable="true">old</span> and <span id="blk" contenteditable="true" style="display:block">old</span></p>',
      );
      const inline = document.getElementById('inl') as HTMLElement;
      const block = document.getElementById('blk') as HTMLElement;
      (inline.firstChild as Text).data = 'Charlie inline draft';
      (block.firstChild as Text).data = 'Charlie block draft';
      addControl('Control paragraph charlie.');
      await expectDraftBlocked(ctx, 'Control paragraph charlie.', 'Charlie', inline);
      expect(ctx.observed.filter((el) => block.contains(el))).toEqual([]);
      expect(ctx.dirtyRounds.flat()).toEqual(expect.arrayContaining([inline, block]));
    });

    it('(d) does not send a draft when the area became editable after its unit was sent', async () => {
      const ctx = setup(`${FEED}<div id="box"><p id="mine">Original sentence text.</p></div>`);
      await ctx.session.start();
      ctx.show();
      await vi.waitFor(() => expect(ctx.port.calls).toHaveLength(1));
      const mine = document.getElementById('mine') as HTMLElement;
      const observedBefore = ctx.observed.filter((el) => el === mine).length;
      document.getElementById('box')?.setAttribute('contenteditable', 'true');
      (mine.firstChild as Text).data = 'Delta typed draft.';
      addControl('Control paragraph delta.');
      await wait();
      ctx.show();
      await vi.waitFor(() => expect(ctx.sentTexts()).toContain('Control paragraph delta.'));
      // The stale reply comes back and triggers its own rescan.
      ctx.port.calls[0]?.answer();
      await wait(100);
      ctx.show();
      expect(ctx.sentTexts().filter((text) => text.includes('Delta typed'))).toEqual([]);
      expect(ctx.observed.filter((el) => el === mine)).toHaveLength(observedBefore);
      expect(ctx.dirtyRounds.flat()).toContain(mine);
    });

    it('(e) ignores a paragraph added inside translate="no"', async () => {
      const ctx = await started('<div id="nt" translate="no"><p>Kept as is.</p></div>');
      const holder = document.getElementById('nt') as HTMLElement;
      const added = document.createElement('p');
      added.textContent = 'Echo untranslated paragraph.';
      holder.append(added);
      addControl('Control paragraph echo.');
      await expectDraftBlocked(ctx, 'Control paragraph echo.', 'Echo untranslated', holder);
      expect(ctx.dirtyRounds.flat()).toContain(holder);
    });

    it('(f) still translates a paragraph added inside an aria-hidden area', async () => {
      const { session, show, sentTexts } = setup('<div id="hid" aria-hidden="true"></div>');
      await session.start();
      const added = document.createElement('p');
      added.textContent = 'Foxtrot hidden area paragraph.';
      document.getElementById('hid')?.append(added);
      await wait();
      show();
      await vi.waitFor(() => expect(sentTexts()).toContain('Foxtrot hidden area paragraph.'));
    });

    it('(g) still translates a paragraph added in an ordinary area', async () => {
      const { session, show, sentTexts } = setup('<div id="plain"></div>');
      await session.start();
      const added = document.createElement('p');
      added.textContent = 'Golf ordinary area paragraph.';
      document.getElementById('plain')?.append(added);
      await wait();
      show();
      await vi.waitFor(() => expect(sentTexts()).toContain('Golf ordinary area paragraph.'));
    });
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

  it('pushes the pinned engine at start and the new one when it is switched', async () => {
    const { session, runFrame } = setup('<p>Switch engine text.</p>');
    const seen: (string | undefined)[] = [];
    session.subscribe((state) => seen.push(state.engine));
    await session.start();
    runFrame();
    // The engine is fixed as soon as the config is read: pushed right away.
    expect(seen).toEqual(['google']);
    await session.start({ engine: 'deepseek' });
    runFrame();
    expect(seen).toEqual(['google', 'deepseek']);
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

describe('page session: watching before the initial scan', () => {
  const NEW_BLOCKS = '<div id="n"><div>New heading text.</div><div>New body text.</div></div>';

  /**
   * The mutation watch is a fake that keeps its options. The first element of `tag` the
   * scan asks about runs `hook` synchronously (once, and only after the watch exists,
   * so a start that watches too late changes the DOM without telling anyone).
   */
  function midScan(
    markup: string,
    tag: string,
    hook: (options: MutationWatchOptions, ctx: ReturnType<typeof setup>) => void,
    getConfig?: () => Promise<ReturnType<typeof createDefaultConfig>>,
    extra: Partial<SessionDeps> = {},
  ) {
    let options: MutationWatchOptions | undefined;
    let unwatched = 0;
    let fired = false;
    let ctx!: ReturnType<typeof setup>;
    ctx = setup(markup, getConfig, {
      createReadStyle: () => (el) => {
        if (!fired && options && el.tagName === tag) {
          fired = true;
          hook(options, ctx);
        }
        return readStyle(el);
      },
      createMutationWatch: (given) => {
        options = given;
        return () => {
          unwatched += 1;
        };
      },
      ...extra,
    });
    return {
      ...ctx,
      unwatched: () => unwatched,
      onDirty: (els: Element[]) => options?.onDirty(els),
    };
  }

  const answerAll = async (t: ReturnType<typeof setup>) => {
    for (const call of t.port.calls) call.answer();
    await wait(10);
  };

  it('translates a paragraph added to a container the scan had already passed', async () => {
    const t = midScan(
      '<div id="a"><p>Early text here.</p></div><div><p>Later <span>text</span> here.</p></div>',
      'SPAN',
      (options) => {
        const box = document.getElementById('a') as HTMLElement;
        box.insertAdjacentHTML('beforeend', '<p>Inserted late text.</p>');
        options.onDirty([box]);
      },
    );
    await t.session.start();
    await vi.waitFor(() => expect(t.observed.length).toBeGreaterThanOrEqual(3));
    t.show();
    await vi.waitFor(() => expect(t.sentTexts()).toContain('Inserted late text.'));
    await answerAll(t);
    await vi.waitFor(() => expect(translations()).toContain('译:Inserted late text.'));
    await t.session.stop();
  });

  it('sends blocks added to an unfinished container as separate blocks, each text once', async () => {
    const t = midScan(
      '<div id="feed"><div><span>Old one</span> text here.</div><div>Old two text here.</div></div>',
      'SPAN',
      (options) => {
        const feed = document.getElementById('feed') as HTMLElement;
        feed.insertAdjacentHTML('beforeend', NEW_BLOCKS);
        options.onDirty([feed]);
      },
    );
    await t.session.start();
    await vi.waitFor(() => expect(t.observed.length).toBeGreaterThanOrEqual(4));
    t.show();
    await vi.waitFor(() => expect(t.sentTexts().length).toBeGreaterThanOrEqual(4));
    await wait(30);
    expect([...t.sentTexts()].sort()).toEqual(
      [
        'New body text.',
        'New heading text.',
        '<t0>Old one</t0> text here.',
        'Old two text here.',
      ].sort(),
    );
    await t.session.stop();
  });

  it('sends link text once when something is added to the link during the scan', async () => {
    const t = midScan(
      '<p id="p">Read <a id="a" href="/x"><b>the</b> guide</a> now.</p>',
      'B',
      (options) => {
        const link = document.getElementById('a') as HTMLElement;
        link.insertAdjacentHTML('beforeend', '<svg></svg>');
        options.onDirty([link]);
      },
    );
    await t.session.start();
    await vi.waitFor(() => expect(t.observed.length).toBeGreaterThanOrEqual(1));
    t.show();
    await vi.waitFor(() => expect(t.sentTexts().length).toBeGreaterThanOrEqual(1));
    await wait(30);
    expect(t.sentTexts().filter((text) => text.includes('guide'))).toHaveLength(1);
    expect(t.sentTexts()).toHaveLength(1);
    // The hook really fired during the scan.
    expect(document.querySelector('#a svg')).not.toBeNull();
    await t.session.stop();
  });

  it('stops watching when stopped during the scan', async () => {
    const t = midScan('<div><p>One <span>two</span> three.</p></div>', 'SPAN', () => {
      void t.session.stop();
    });
    await t.session.start();
    expect(t.session.state().phase).toBe('idle');
    expect(t.unwatched()).toBe(1);
  });

  it('applies a style set while the config was loading', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = setup('<p>Style during load text.</p>', async () => {
      await gate;
      return createDefaultConfig('zh-CN');
    });
    const started = t.session.start();
    await vi.waitFor(() => expect(t.configListeners).toHaveLength(1));
    const next = createDefaultConfig('zh-CN');
    next.page.style = 'highlight';
    for (const listener of t.configListeners) listener(next);
    release();
    await started;
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    await answerAll(t);
    await vi.waitFor(() =>
      expect(document.querySelector('et-tr')?.getAttribute('data-et-s')).toBe('highlight'),
    );
    await t.session.stop();
  });

  it('applies a style set while the page is being scanned', async () => {
    const next = createDefaultConfig('zh-CN');
    next.page.style = 'underline';
    const t = midScan('<p>Style <span>during</span> scan text.</p>', 'SPAN', (_options, ctx) => {
      for (const listener of ctx.configListeners) listener(next);
    });
    await t.session.start();
    t.show();
    await vi.waitFor(() => expect(t.port.calls).toHaveLength(1));
    await answerAll(t);
    await vi.waitFor(() =>
      expect(document.querySelector('et-tr')?.getAttribute('data-et-s')).toBe('underline'),
    );
    await t.session.stop();
  });

  it('still finishes stopping when the config cannot be read and the unsubscribe throws', async () => {
    const t = setup(
      '<p>Unreadable and gone text.</p>',
      async () => {
        throw new Error('storage gone');
      },
      {
        watchConfig: () => () => {
          throw new Error('extension gone');
        },
      },
    );
    await expect(t.session.start()).rejects.toThrow('storage gone');
    expect(t.session.state().phase).toBe('idle');
    expect(t.statuses.at(-1)).toBe('idle');
  });
});
