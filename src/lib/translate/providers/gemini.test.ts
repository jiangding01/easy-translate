import { describe, expect, it } from 'vitest';
import { collect, jsonResponse, makeCtx, mockFetch, sseResponse } from '../test-utils';
import { createGeminiAdapter } from './gemini';

const adapter = createGeminiAdapter();
const part = (text: string, extra = {}) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text, ...extra }] } }] })}\n\n`;
const OUTPUT = '[{"i":0,"t":"你好"}]';
const run = (fn: ReturnType<typeof mockFetch>, overrides = {}) =>
  collect(adapter.translate(['hello'], makeCtx({ fetch: fn, ...overrides })));

describe('gemini adapter', () => {
  it('builds the URL, key header, systemInstruction and contents', async () => {
    const fn = mockFetch(sseResponse([part(OUTPUT)]));
    const events = await run(fn, { settings: { baseURL: '', model: 'models/my-model' } });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/my-model:streamGenerateContent?alt=sse',
    );
    expect(url).not.toContain('sk-secret-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('sk-secret-key');
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toContain('"t":"hello"');
    expect(events).toEqual([{ type: 'item', index: 0, text: '你好' }]);
  });

  it('accumulates text across chunks and skips thought parts', async () => {
    const fn = mockFetch(
      sseResponse([
        part('thinking...', { thought: true }),
        part(OUTPUT.slice(0, 8)),
        part(OUTPUT.slice(8)),
      ]),
    );
    expect(await run(fn)).toEqual([{ type: 'item', index: 0, text: '你好' }]);
  });

  it.each([
    [401, 'provider/unauthorized'],
    [403, 'provider/unauthorized'],
    [404, 'provider/not-found'],
    [429, 'rate-limit/too-many-requests'],
    [503, 'provider/server-error'],
  ])('maps HTTP %i', async (status, code) => {
    await expect(run(mockFetch(new Response('{}', { status })))).rejects.toMatchObject({ code });
  });

  it('maps a 400 invalid-key response to unauthorized', async () => {
    const fn = mockFetch(
      jsonResponse({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }, 400),
    );
    await expect(run(fn)).rejects.toMatchObject({ code: 'provider/unauthorized' });
  });

  it('requires a model', async () => {
    const fn = mockFetch();
    await expect(run(fn, { settings: { baseURL: '', model: '' } })).rejects.toMatchObject({
      code: 'config/model-required',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  const chunk = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;

  it('maps promptFeedback.blockReason to content-blocked', async () => {
    const fn = mockFetch(sseResponse([chunk({ promptFeedback: { blockReason: 'SAFETY' } })]));
    await expect(run(fn)).rejects.toMatchObject({
      code: 'provider/content-blocked',
      retryable: false,
    });
  });

  it.each(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'])(
    'maps finishReason %s to content-blocked',
    async (finishReason) => {
      const fn = mockFetch(
        sseResponse([
          part(OUTPUT),
          chunk({ candidates: [{ content: { parts: [] }, finishReason }] }),
        ]),
      );
      await expect(run(fn)).rejects.toMatchObject({
        code: 'provider/content-blocked',
        retryable: false,
      });
    },
  );

  it('maps finishReason MAX_TOKENS to output-truncated', async () => {
    const fn = mockFetch(
      sseResponse([
        chunk({
          candidates: [{ content: { parts: [{ text: '[{"i":0' }] }, finishReason: 'MAX_TOKENS' }],
        }),
      ]),
    );
    await expect(run(fn)).rejects.toMatchObject({
      code: 'provider/output-truncated',
      retryable: false,
    });
  });

  it('accepts finishReason STOP', async () => {
    const fn = mockFetch(
      sseResponse([
        chunk({ candidates: [{ content: { parts: [{ text: OUTPUT }] }, finishReason: 'STOP' }] }),
      ]),
    );
    expect(await run(fn)).toEqual([{ type: 'item', index: 0, text: '你好' }]);
  });

  it('maps an error object in the stream to server-error', async () => {
    const fn = mockFetch(sseResponse([part('[{"i":0'), chunk({ error: { code: 500 } })]));
    await expect(run(fn)).rejects.toMatchObject({ code: 'provider/server-error' });
  });
});
