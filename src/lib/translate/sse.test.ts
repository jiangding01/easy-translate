import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSse } from './sse';
import { sseResponse, streamOf } from './test-utils';

async function all(response: Response, idleMs?: number) {
  const out: string[] = [];
  for await (const data of readSse(response, { idleMs })) out.push(data);
  return out;
}

afterEach(() => vi.useRealTimers());

describe('readSse', () => {
  it('joins lines split across chunks', async () => {
    const response = sseResponse(['data: hel', 'lo\n', '\ndata: wor', 'ld\n\n']);
    expect(await all(response)).toEqual(['hello', 'world']);
  });

  it('joins multi-line data with newlines and ignores comments and other fields', async () => {
    const response = sseResponse([': keep-alive\nevent: x\nid: 1\ndata: a\ndata: b\n\n']);
    expect(await all(response)).toEqual(['a\nb']);
  });

  it('handles CRLF, lone CR, and CRLF split across chunks', async () => {
    const response = sseResponse(['data: one\r\n\r\ndata: two\r', '\n\r', 'data: three\r\r']);
    expect(await all(response)).toEqual(['one', 'two', 'three']);
  });

  it('dispatches a final event without a trailing blank line', async () => {
    expect(await all(sseResponse(['data: tail']))).toEqual(['tail']);
  });

  it('fails with a retryable timeout after the idle period, once data has started', async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const iterator = readSse(new Response(stream), { idleMs: 1000 });
    const first = iterator.next();
    // Before any data there is no idle timer.
    await vi.advanceTimersByTimeAsync(5000);
    controller.enqueue(new TextEncoder().encode('data: a\n\n'));
    expect(await first).toEqual({ done: false, value: 'a' });

    const second = iterator.next();
    const assertion = expect(second).rejects.toMatchObject({
      code: 'network/timeout',
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('maps a broken stream to a retryable network error', async () => {
    const response = new Response(streamOf(['data: a\n\n'], new Error('reset')));
    await expect(all(response)).rejects.toMatchObject({ code: 'network/fetch-failed' });
  });
});
