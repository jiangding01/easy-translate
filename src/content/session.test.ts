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

function setup(markup: string) {
  document.body.innerHTML = markup;
  const before = document.body.innerHTML;
  const port = fakePort();
  const statuses: PageStatus[] = [];
  const observed: Element[] = [];
  let notify: ((targets: Element[], visible: boolean[]) => void) | undefined;
  const session = createPageSession({
    win: window,
    port,
    getConfig: async () => createDefaultConfig('zh-CN'),
    reportStatus: (status) => statuses.push(status),
    createReadStyle: () => readStyle,
    createViewport: (onChange) => {
      notify = onChange;
      return {
        observe: (target) => observed.push(target),
        disconnect: () => {
          observed.length = 0;
        },
      };
    },
    createMutationWatch: (options) => watchMutations({ ...options, debounceMs: 5 }),
  });
  /** Reports every observed root (or the given ones) as in range. */
  const show = (targets: Element[] = [...observed]) =>
    notify?.(
      targets,
      targets.map(() => true),
    );
  const sentTexts = () => port.calls.flatMap((call) => call.payload.items.map((item) => item.text));
  return { session, port, statuses, observed, show, before, sentTexts };
}

const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const translations = () => [...document.querySelectorAll('et-tr')].map((el) => el.textContent);
const engineError = (code: `${string}/${string}`): AppError =>
  appError('provider', code as AppError['code'], 'engine problem');

beforeEach(() => {
  document.head.innerHTML = '';
});

describe('page session: happy path', () => {
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
