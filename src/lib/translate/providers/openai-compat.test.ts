import { describe, expect, it } from 'vitest';
import { normalizeBaseURL } from '../base-url';
import { collect, jsonResponse, makeCtx, mockFetch, sseResponse } from '../test-utils';
import { createOpenAICompatAdapter } from './openai-compat';

const adapter = createOpenAICompatAdapter();
const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const OUTPUT = '[{"i":0,"t":"你好"},{"i":1,"t":"世界"}]';

const run = (fn: ReturnType<typeof mockFetch>, overrides = {}) =>
  collect(adapter.translate(['hello', 'world'], makeCtx({ fetch: fn, ...overrides })));

describe('normalizeBaseURL', () => {
  it.each([
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1'],
    ['  https://x.com/v1  ', 'https://x.com/v1'],
    ['https://x.com/v1/chat/completions', 'https://x.com/v1'],
    ['https://x.com/v1/chat/completions/', 'https://x.com/v1'],
    ['https://x.com/v1/responses', 'https://x.com/v1'],
    ['https://x.com/v1/completions', 'https://x.com/v1'],
    ['https://x.com/v1/Chat/Completions', 'https://x.com/v1'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBaseURL(input)).toBe(expected);
  });
});

describe('openai-compat adapter', () => {
  it('exposes llm limits', () => {
    expect(adapter.kind).toBe('llm');
    expect(adapter.limits).toEqual({ maxItems: 20, maxChars: 3000 });
  });

  it('sends a streaming chat completion with a Bearer header', async () => {
    const fn = mockFetch(sseResponse([delta(OUTPUT), 'data: [DONE]\n\n']));
    const events = await run(fn);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret-key');
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('m');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(body.messages[1].content).toContain('"i":1');
    expect(events).toEqual([
      { type: 'item', index: 0, text: '你好' },
      { type: 'item', index: 1, text: '世界' },
    ]);
  });

  it('omits Authorization without a key', async () => {
    const fn = mockFetch(sseResponse([delta(OUTPUT), 'data: [DONE]\n\n']));
    await run(fn, { apiKey: undefined });
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('accumulates deltas split across chunks, with comments', async () => {
    const full = `: ping\n\n${delta(OUTPUT.slice(0, 10))}${delta(OUTPUT.slice(10))}data: [DONE]\n\n`;
    const middle = Math.floor(full.length / 2);
    const fn = mockFetch(sseResponse([full.slice(0, middle), full.slice(middle)]));
    expect(await run(fn)).toHaveLength(2);
  });

  it('accepts a stream that ends with finish_reason but no [DONE]', async () => {
    const stop = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`;
    const fn = mockFetch(sseResponse([delta(OUTPUT), stop]));
    expect(await run(fn)).toHaveLength(2);
  });

  it.each([
    [401, 'provider/unauthorized', false],
    [404, 'provider/not-found', false],
    [500, 'provider/server-error', true],
  ])('maps HTTP %i', async (status, code, retryable) => {
    const fn = mockFetch(new Response('{}', { status }));
    await expect(run(fn)).rejects.toMatchObject({ code, retryable });
  });

  it('maps 429 with retry-after as retryable rate limiting', async () => {
    const fn = mockFetch(
      jsonResponse({ error: { code: 'rate_limit' } }, 429, { 'retry-after': '2' }),
    );
    await expect(run(fn)).rejects.toMatchObject({
      code: 'rate-limit/too-many-requests',
      retryable: true,
      retryAfterMs: 2000,
    });
  });

  it('maps 429 insufficient_quota as non-retryable', async () => {
    const fn = mockFetch(jsonResponse({ error: { code: 'insufficient_quota' } }, 429));
    await expect(run(fn)).rejects.toMatchObject({
      code: 'provider/quota-exceeded',
      retryable: false,
    });
  });

  it('reports a stream cut mid-way as a retryable network error', async () => {
    const fn = mockFetch(sseResponse([delta('[{"i":0')], new Error('reset')));
    await expect(run(fn)).rejects.toMatchObject({ code: 'network/fetch-failed', retryable: true });
    const early = mockFetch(sseResponse([delta('[{"i":0')]));
    await expect(run(early)).rejects.toMatchObject({ code: 'network/stream-interrupted' });
  });

  it('fails with bad-response when the model output is not valid', async () => {
    const fn = mockFetch(sseResponse([delta('sorry, no'), 'data: [DONE]\n\n']));
    await expect(run(fn)).rejects.toMatchObject({ code: 'validation/bad-response' });
  });

  it('requires a model', async () => {
    const fn = mockFetch();
    await expect(
      run(fn, { settings: { baseURL: 'https://x.com', model: ' ' } }),
    ).rejects.toMatchObject({ code: 'config/model-required' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('never puts the key or the source text into error messages', async () => {
    const failures = [
      mockFetch(new Response('sk-secret-key hello', { status: 401 })),
      mockFetch(new Response('sk-secret-key hello', { status: 500 })),
      mockFetch(new TypeError('sk-secret-key hello')),
      mockFetch(sseResponse([delta('hello sk-secret-key'), 'data: [DONE]\n\n'])),
    ];
    for (const fn of failures) {
      const error = await run(fn).catch((e: unknown) => e);
      const text = JSON.stringify(error);
      expect(text).not.toContain('sk-secret-key');
      expect(text).not.toContain('hello');
    }
  });

  it.each([
    ['length', 'provider/output-truncated'],
    ['content_filter', 'provider/content-blocked'],
  ])('maps finish_reason %s to %s, not retryable', async (reason, code) => {
    const end = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;
    const fn = mockFetch(sseResponse([delta(OUTPUT), end, 'data: [DONE]\n\n']));
    await expect(run(fn)).rejects.toMatchObject({ code, retryable: false });
  });
});
