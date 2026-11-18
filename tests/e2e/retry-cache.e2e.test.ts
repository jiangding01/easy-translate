import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// P0-4 and P0-5: a failed paragraph can be retried; a second page load is served from cache.

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
  await prepare(h, { clearCache: true });
});

afterAll(() => h?.close());

const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;

/** The translation text under `selector` (excluding failure placeholders), if any. */
const translation = (selector: string) =>
  h.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(`${selector} > et-tr:not([data-et-state])`)})?.textContent ?? null`,
  );

describe('failure and retry', () => {
  it('shows a retry placeholder for a failed paragraph and translates it after a click', async () => {
    // The whole request fails when it carries the intro, and so does the /single fallback.
    h.mockGoogle((text) => (text.includes('fishing boats') ? 500 : undefined));
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');

    const placeholder = '#intro > et-tr[data-et-state="error"]';
    // The page retries a failed request three times (0.5 s, 1 s, 2 s apart) before it gives up.
    await waitFor(() => h.evaluate(`!!document.querySelector('${placeholder} button')`), {
      timeout: 20_000,
      message: 'the failure placeholder with its retry button',
    });
    expect(await h.evaluate(`document.querySelector('${placeholder}').textContent`)).toMatch(
      /not translated/i,
    );
    expect(await translation('#intro')).toBeNull();
    expect((await state()).failed).toBeGreaterThan(0);

    // The service is back: a real (trusted) click on the button retries that paragraph.
    h.mockGoogle();
    await h.trustedClick(`${placeholder} button`);
    await waitFor(async () => (await translation('#intro'))?.includes('【MOCK】'), {
      message: 'the retried paragraph to be translated',
    });
    expect(await h.evaluate(`!!document.querySelector('${placeholder}')`)).toBe(false);
    h.assertNoErrors();
  });
});

describe('cache', () => {
  it('serves a second load of the page without asking Google again', async () => {
    h.mockGoogle();
    await prepare(h, { clearCache: true });
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).translated >= 8, {
      message: 'the first screen to be translated',
    });
    await waitFor(async () => (await state()).phase === 'done', { message: 'the page to settle' });
    expect(h.google.count).toBeGreaterThan(0);
    const first = await translation('#title');
    expect(first).toContain('【MOCK】');

    // A new document, an empty request counter, and the same paragraphs.
    h.resetLogs();
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).translated >= 8, {
      message: 'the first screen to be translated from the cache',
    });
    expect(await translation('#title')).toBe(first);
    expect(h.google.count).toBe(0);
    h.assertNoErrors();
  });
});
