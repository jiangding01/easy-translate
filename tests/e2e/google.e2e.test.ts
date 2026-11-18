import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, mockTranslate, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// P1: how the page copes with what the Google endpoints answer (tags dropped, echoes, 403).
// Each case starts from an empty cache, or the answers of an earlier case would be reused.

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
});

beforeEach(() => prepare(h, { clearCache: true }));

afterAll(() => h?.close());

const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
const ANY_TAG = /<[^>]+>/g;
const LINK = '#linked et-tr a[href="https://example.com/harbour-weather"]';

/** Opens the article, starts translating and waits for the first screen (8 blocks). */
async function translateArticle() {
  await h.openPage('e2e-article.html');
  await h.tell('page.toggle');
  await waitFor(async () => (await state()).translated >= 8, {
    message: 'the first screen to be translated',
  });
}

/** Width of the original's own text in #linked (zero when translation-only hides it). */
const originalWidth = () =>
  h.evaluate<number>(`(() => {
    const node = [...document.querySelector('#linked').childNodes].find(
      (n) => n.nodeType === 3 && n.textContent.trim(),
    );
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().width;
  })()`);

describe('google answers', () => {
  it('asks again in HTML mode when the plain answer lost the link tags', async () => {
    const html: string[] = [];
    // The plain endpoint drops inline tags; HTML mode keeps them, as the real one does.
    h.mockGoogle((text, request) => {
      if (request.html) html.push(text);
      const translated = mockTranslate(text);
      return request.html ? translated : translated.replace(ANY_TAG, '');
    });
    await translateArticle();

    // The first request carried the tags, the repair request is HTML, and the link is back.
    expect(h.google.texts.some((text) => /<t\d+>town notice board<\/t\d+>/.test(text))).toBe(true);
    expect(html.some((text) => text.includes('<a id="t0">town notice board</a>'))).toBe(true);
    await waitFor(() => h.evaluate(`!!document.querySelector('${LINK}')`), {
      message: 'the link to be back in the translation',
    });
    expect(await h.evaluate(`document.querySelector('#linked et-tr').textContent`)).toContain(
      '【MOCK】',
    );
    h.assertNoErrors();
  });

  it('hides the original of a paragraph whose links were lost, in translation-only', async () => {
    const html: string[] = [];
    // Both endpoints drop the tags: the paragraph stays plain text.
    h.mockGoogle((text, request) => {
      if (request.html) html.push(text);
      return mockTranslate(text).replace(ANY_TAG, '');
    });
    await translateArticle();
    expect(html.length).toBeGreaterThan(0);
    expect(await h.evaluate(`!!document.querySelector('${LINK}')`)).toBe(false);
    expect(await h.evaluate(`document.querySelector('#linked et-tr').textContent`)).toContain(
      '【MOCK】',
    );
    expect(await originalWidth()).toBeGreaterThan(0);

    expect(await h.tell('page.setMode', 'translation')).toMatchObject({ ok: true });
    await waitFor(
      () => h.evaluate(`document.querySelector('#linked').hasAttribute('data-et-only')`),
      {
        message: '#linked to be translation-only',
      },
    );
    expect(await originalWidth()).toBe(0);
    h.assertNoErrors();
  });

  it('retries a paragraph the plain endpoint echoed on the single endpoint', async () => {
    const single: string[] = [];
    // /t answers the intro with its own English sentence; /single translates it.
    h.mockGoogle((text, request) => {
      if (request.single) single.push(text);
      return text.includes('fishing boats') && !request.single ? text : undefined;
    });
    await translateArticle();

    expect(single.some((text) => text.includes('fishing boats'))).toBe(true);
    await waitFor(
      () =>
        h.evaluate(
          `document.querySelector('#intro > et-tr:not([data-et-state])')?.textContent.includes('【MOCK】')`,
        ),
      { message: 'the echoed paragraph to be translated by the retry' },
    );
    h.assertNoErrors();
  });

  it('pauses on 403 from both endpoints, tells the reader, and recovers after a retry', async () => {
    h.mockGoogle(() => 403);
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).engineError?.code === 'provider/unauthorized', {
      message: 'the session to pause on an unauthorized engine',
    });
    expect((await state()).translated).toBe(0);
    // The isle says so: the engine button is flagged and its label carries the reason.
    const label = await waitFor(
      () =>
        h.shadow<string | null>(
          'et-isle',
          `(root) => root.querySelector('[data-err]')?.getAttribute('aria-label') ?? null`,
        ),
      { message: 'the isle to show the engine error' },
    );
    expect(label).toMatch(/invalid/i);

    // The service is back; a retry resumes the paused session.
    h.mockGoogle();
    await h.tell('page.retryFailed');
    await waitFor(async () => (await state()).translated >= 8, {
      message: 'the page to be translated after the retry',
    });
    expect((await state()).engineError).toBeUndefined();
    expect(await h.shadow('et-isle', `(root) => !root.querySelector('[data-err]')`)).toBe(true);
    h.assertNoErrors();
  });
});
