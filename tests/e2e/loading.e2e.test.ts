import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// Paragraph loading dots (docs/plans/paragraph-loading.md): a slow service shows a small dot
// at the end of the waiting paragraph, replaced in place by the translation or the failure note.

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
});

afterAll(() => h?.close());

/** Requests held back by `slowGoogle`; every one is let go when the case ends. */
const releases: (() => void)[] = [];

/** Google answers only once the returned function is called (a slow service). */
function slowGoogle(): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  h.mockGoogle(async () => {
    await gate;
    return undefined;
  });
  return release;
}

beforeEach(async () => {
  // No cache hits: every paragraph has to go to the (mocked) service.
  await prepare(h, { clearCache: true });
});

afterEach(() => {
  // A request left hanging would be answered into a closed page later.
  for (const release of releases.splice(0)) release();
  h.mockGoogle();
});

const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
const DOT = 'et-tr[data-et-state="loading"]';
const has = (selector: string) => h.evaluate<boolean>(`!!document.querySelector('${selector}')`);

/** The translation text under `selector` (excluding failure and loading notes), if any. */
const translation = (selector: string) =>
  h.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(`${selector} > et-tr:not([data-et-state])`)})?.textContent ?? null`,
  );

describe('loading dots', () => {
  it('shows a dot at the end of a waiting paragraph and swaps it for the translation', async () => {
    const release = slowGoogle();
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');
    await waitFor(() => has(`#intro > ${DOT}`), {
      timeout: 10_000,
      message: 'a loading dot in the waiting paragraph',
    });
    const dot = await h.evaluate<{ text: string; hidden: string | null; last: boolean }>(`(() => {
      const el = document.querySelector('#intro > ${DOT}');
      return { text: el.textContent, hidden: el.getAttribute('aria-hidden'), last: el === document.querySelector('#intro').lastElementChild };
    })()`);
    expect(dot).toEqual({ text: '', hidden: 'true', last: true });
    expect(await translation('#intro')).toBeNull();

    release();
    await waitFor(async () => (await translation('#intro'))?.includes('【MOCK】'), {
      message: 'the paragraph to be translated',
    });
    // Only the translation is left: the dot went in the same write.
    expect(await has(DOT)).toBe(false);
    expect(await h.evaluate<number>(`document.querySelectorAll('#intro > et-tr').length`)).toBe(1);
    h.assertNoErrors();
  });

  it('puts a dot where the failure note was at once after a retry, then the translation', async () => {
    h.mockGoogle((text) => (text.includes('fishing boats') ? 500 : undefined));
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');
    const note = '#intro > et-tr[data-et-state="error"]';
    // A failed request is retried three times (0.5 s, 1 s, 2 s apart) before the note shows.
    await waitFor(() => has(`${note} button`), {
      timeout: 20_000,
      message: 'the failure note with its retry button',
    });

    const release = slowGoogle();
    await h.trustedClick(`${note} button`);
    // Well inside the 600 ms a waiting paragraph gets before its dot: the retry shows it itself.
    await waitFor(() => has(`#intro > ${DOT}`), {
      timeout: 450,
      interval: 25,
      message: 'the dot right after the retry click',
    });
    expect(await has(note)).toBe(false);
    expect(await translation('#intro')).toBeNull();

    release();
    await waitFor(async () => (await translation('#intro'))?.includes('【MOCK】'), {
      message: 'the retried paragraph to be translated',
    });
    expect(await has(`#intro > ${DOT}`)).toBe(false);
    expect(await h.evaluate<number>(`document.querySelectorAll('#intro > et-tr').length`)).toBe(1);
    h.assertNoErrors();
  });

  it('does not move the paragraph at the top of the viewport when translations arrive above it', async () => {
    const release = slowGoogle();
    await h.openPage('e2e-article.html');
    // Scroll until the title and the intro are above the viewport; #linked is the first one in view.
    await h.evaluate(
      `window.scrollTo(0, document.querySelector('#intro').getBoundingClientRect().bottom + scrollY + 4)`,
    );
    const top = () =>
      h.evaluate<number>(`document.querySelector('#linked').getBoundingClientRect().top`);
    await waitFor(async () => (await top()) < 60, { message: 'the scroll to settle' });
    await h.tell('page.toggle');
    await waitFor(() => has(`#linked > ${DOT}`), { message: 'the dots, i.e. requests are held' });
    const before = await top();
    expect(
      await h.evaluate<boolean>(
        `document.querySelector('#intro').getBoundingClientRect().bottom <= 0`,
      ),
    ).toBe(true);

    release();
    await waitFor(async () => (await translation('#intro'))?.includes('【MOCK】'), {
      message: 'the paragraph above the viewport to be translated',
    });
    await waitFor(async () => (await translation('#linked'))?.includes('【MOCK】'), {
      message: 'the paragraph at the top to be translated',
    });
    expect(Math.abs((await top()) - before)).toBeLessThan(1);
    h.assertNoErrors();
  });

  it('does not change the height of a one-line paragraph when its dot shows', async () => {
    const release = slowGoogle();
    await h.openPage('e2e-article.html');
    const ids = ['title', 'quote', 'pinned'];
    const heights = () =>
      h.evaluate<number[]>(
        `${JSON.stringify(ids)}.map((id) => document.getElementById(id).getBoundingClientRect().height)`,
      );
    const before = await heights();
    await h.tell('page.toggle');
    for (const id of ids) {
      await waitFor(() => has(`#${id} > ${DOT}`), { message: `the dot in #${id}` });
    }
    expect(await heights()).toEqual(before);
    release();
    await waitFor(async () => (await state()).translated >= 8, {
      message: 'the first screen to be translated',
    });
    h.assertNoErrors();
  });
});
