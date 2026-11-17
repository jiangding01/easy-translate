import { describe, expect, it } from 'vitest';
import { collect, jsonResponse, makeCtx, mockFetch } from '../test-utils';
import { createGoogleAdapter } from './google';

const adapter = createGoogleAdapter();
const run = (batch: string[], fetchImpl: ReturnType<typeof mockFetch>) =>
  collect(adapter.translate(batch, makeCtx({ fetch: fetchImpl, source: 'auto', target: 'en' })));
const call = (fn: ReturnType<typeof mockFetch>, index: number) => {
  const [url, init] = fn.mock.calls[index] as unknown as [string, RequestInit];
  return { url, init };
};

describe('google adapter', () => {
  it('exposes mt limits', () => {
    expect(adapter.kind).toBe('mt');
    expect(adapter.limits).toEqual({ maxItems: 50, maxChars: 5000 });
  });

  it('POSTs a form body with repeated q and keeps the text out of the URL', async () => {
    const fn = mockFetch(
      jsonResponse([
        ['Hello', 'zh-CN'],
        ['World', 'zh-CN'],
      ]),
    );
    const events = await run(['你好', '世界'], fn);
    const { url, init } = call(fn, 0);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toMatch(
      /^application\/x-www-form-urlencoded/,
    );
    expect(url).toBe('https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=en');
    expect(url).not.toContain(encodeURIComponent('你好'));
    expect((init.body as URLSearchParams).getAll('q')).toEqual(['你好', '世界']);
    expect(events).toEqual([
      { type: 'item', index: 0, text: 'Hello' },
      { type: 'item', index: 1, text: 'World' },
    ]);
  });

  it.each([
    ['array of arrays', [['Hi', 'zh-CN']]],
    ['plain string', 'Hi'],
    ['flat array with language', ['Hi', 'zh-CN']],
  ])('parses a single-item response: %s', async (_name, body) => {
    const events = await run(['你好'], mockFetch(jsonResponse(body)));
    expect(events).toEqual([{ type: 'item', index: 0, text: 'Hi' }]);
  });

  it.each([403, 404, 500, 503])('falls back to the single endpoint on HTTP %i', async (status) => {
    const fn = mockFetch(
      new Response('', { status }),
      jsonResponse([
        [
          ['One', 'a'],
          [' two', 'b'],
        ],
        null,
        'zh-CN',
      ]),
      jsonResponse([[['Three', 'c']]]),
    );
    const events = await run(['a', 'b'], fn);
    expect(events.map((e) => (e.type === 'item' ? e.text : ''))).toEqual(['One two', 'Three']);
    const second = call(fn, 1);
    expect(second.init.method).toBe('GET');
    expect(second.url).toContain('/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=a');
  });

  it('falls back on a network error and on an unparseable body', async () => {
    const single = () => jsonResponse([[['ok', 'x']]]);
    const net = await run(['x'], mockFetch(new TypeError('offline'), single()));
    expect(net).toEqual([{ type: 'item', index: 0, text: 'ok' }]);
    const bad = await run(['x'], mockFetch(jsonResponse({ unexpected: true }), single()));
    expect(bad).toEqual([{ type: 'item', index: 0, text: 'ok' }]);
  });

  it('does not fall back on 400, 429, or an aborted request', async () => {
    const fn400 = mockFetch(new Response('', { status: 400 }));
    await expect(run(['x'], fn400)).rejects.toMatchObject({ code: 'provider/bad-request' });
    expect(fn400).toHaveBeenCalledTimes(1);

    const fn429 = mockFetch(new Response('', { status: 429, headers: { 'retry-after': '3' } }));
    await expect(run(['x'], fn429)).rejects.toMatchObject({
      code: 'rate-limit/too-many-requests',
      retryAfterMs: 3000,
    });
    expect(fn429).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    const fnAbort = mockFetch(new DOMException('aborted', 'AbortError'));
    await expect(
      collect(adapter.translate(['x'], makeCtx({ fetch: fnAbort, signal: controller.signal }))),
    ).rejects.toMatchObject({ code: 'network/aborted' });
    expect(fnAbort).toHaveBeenCalledTimes(1);
  });

  it('does not fall back for items whose encoded size exceeds 6000 bytes', async () => {
    const fn = mockFetch(new Response('', { status: 500 }));
    await expect(run(['你'.repeat(700)], fn)).rejects.toMatchObject({
      code: 'provider/server-error',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reports an error when the result count differs, without falling back', async () => {
    const fn = mockFetch(jsonResponse([['only', 'en']]));
    await expect(run(['a', 'b'], fn)).rejects.toMatchObject({ code: 'validation/bad-response' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty array', []],
    ['array with null', [null]],
    ['array of non-string rows', [[null, 'en']]],
  ])('treats an odd primary response as malformed: %s', async (_name, body) => {
    const fn = mockFetch(jsonResponse(body), jsonResponse([[['ok', 'x']]]));
    const events = await run(['x'], fn);
    // Not taken as a result: the single endpoint answered instead.
    expect(events).toEqual([{ type: 'item', index: 0, text: 'ok' }]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  describe('items that echo source sentences', () => {
    const SOURCE =
      'How is this different from Dify, n8n or Flowise? Those are general-purpose AI and automation workflow builders.';
    const ECHOED =
      'How is this different from Dify, n8n or Flowise? 这些是通用的 AI 和自动化工作流构建器。';
    const GOOD = ['这与 Dify、n8n 或 Flowise 有何不同？', '这些是通用的 AI 和自动化工作流构建器。'];
    const runZh = (batch: string[], fetchImpl: ReturnType<typeof mockFetch>) =>
      collect(
        adapter.translate(batch, makeCtx({ fetch: fetchImpl, source: 'auto', target: 'zh-CN' })),
      );
    const texts = (events: Awaited<ReturnType<typeof runZh>>) =>
      events.map((e) => (e.type === 'item' ? e.text : ''));

    it('retries only the echoed item on the single endpoint and takes the better answer', async () => {
      const fn = mockFetch(
        jsonResponse([
          [ECHOED, 'en'],
          ['你好', 'en'],
        ]),
        jsonResponse([GOOD.map((text) => [text, 'x']), null, 'en']),
      );
      const events = await runZh([SOURCE, 'Hello'], fn);
      expect(texts(events)).toEqual([GOOD.join(''), '你好']);
      expect(fn).toHaveBeenCalledTimes(2);
      const second = call(fn, 1);
      expect(second.init.method).toBe('GET');
      expect(second.url).toContain(
        `/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(SOURCE)}`,
      );
    });

    it('keeps the first answer when the retry fails or still echoes', async () => {
      const failed = mockFetch(
        jsonResponse([[ECHOED, 'en']]),
        new Response('', { status: 429, headers: { 'retry-after': '3' } }),
      );
      expect(texts(await runZh([SOURCE], failed))).toEqual([ECHOED]);
      expect(failed).toHaveBeenCalledTimes(2);

      const blocked = mockFetch(
        jsonResponse([[ECHOED, 'en']]),
        new Response('<html>', { status: 200 }),
      );
      expect(texts(await runZh([SOURCE], blocked))).toEqual([ECHOED]);

      const still = mockFetch(jsonResponse([[ECHOED, 'en']]), jsonResponse([[[ECHOED, 'x']]]));
      expect(texts(await runZh([SOURCE], still))).toEqual([ECHOED]);
    });

    it('stops retrying after a failed retry', async () => {
      const fn = mockFetch(
        jsonResponse([
          [ECHOED, 'en'],
          [ECHOED, 'en'],
        ]),
        new Response('', { status: 429 }),
      );
      const events = await runZh([SOURCE, `${SOURCE} `], fn);
      expect(texts(events)).toEqual([ECHOED, ECHOED]);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('sends no retry for complete translations or an English target', async () => {
      const fn = mockFetch(jsonResponse([[GOOD.join(''), 'en']]));
      expect(texts(await runZh([SOURCE], fn))).toEqual([GOOD.join('')]);
      expect(fn).toHaveBeenCalledTimes(1);
      const en = mockFetch(jsonResponse([[SOURCE, 'en']]));
      expect(texts(await run([SOURCE], en))).toEqual([SOURCE]);
      expect(en).toHaveBeenCalledTimes(1);
    });
  });
});
