import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// P1: the session around the page: "always translate this site", a quick stop-then-start, and
// a service worker that was stopped in the middle. Each case starts from an empty cache.

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
});

beforeEach(() => prepare(h, { clearCache: true }));

afterAll(() => h?.close());

const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** From the settings page: the display mode every new session starts in. */
async function setPageMode(mode: 'bilingual' | 'translation') {
  const options = await h.extPage('options.html');
  try {
    expect(await options.send('config.patch', [{ path: 'page.mode', value: mode }])).toMatchObject({
      ok: true,
    });
  } finally {
    await options.close();
  }
}

/** The first screen's blocks, plus the paragraph the quick-restart case adds. */
const FIRST_SCREEN = ['#title', '#intro', '#linked', '#coded', '#list li', '#quote', '#fresh'];

/** How many translations each first-screen block holds directly, and the page's total. */
const translations = () =>
  h.evaluate<{ perBlock: number[]; total: number }>(`({
    perBlock: ${JSON.stringify(FIRST_SCREEN)}
      .flatMap((s) => [...document.querySelectorAll(s)])
      .map((el) => el.querySelectorAll(':scope > et-tr').length),
    total: document.querySelectorAll('et-tr').length,
  })`);

describe('session', () => {
  it('starts by itself on a site marked "always translate"', async () => {
    await h.openPage('e2e-article.html');
    const origin = await h.evaluate<string>('location.origin');
    const options = await h.extPage('options.html');
    try {
      expect(await options.send('site.setAlways', { origin, always: true })).toMatchObject({
        ok: true,
        data: { [origin]: { always: true } },
      });
      expect((await state()).translated).toBe(0);

      // A new load of the page begins translating without any command.
      await h.openPage('e2e-article.html');
      await waitFor(async () => (await state()).translated >= 8, {
        message: 'the page to translate itself',
      });
      expect(h.google.count).toBeGreaterThan(0);
      h.assertNoErrors();
    } finally {
      await options.send('site.setAlways', { origin, always: false });
      await options.close();
    }
  });

  it('ends with one translation per block after a quick stop and start', async () => {
    // Translation-only from the first moment: the roots are pinned (font size zero), which the
    // restarted session must not read before the old one has put them back.
    await setPageMode('translation');
    try {
      await h.openPage('e2e-article.html');
      await h.tell('page.toggle');
      await waitFor(
        async () =>
          (await state()).translated >= 8 &&
          (await h.evaluate<boolean>(
            `document.querySelector('#intro').hasAttribute('data-et-only')`,
          )),
        { message: 'the first screen to be translated, translation-only' },
      );

      // Fresh text goes to a slow service: when the stop comes, the first screen is on show and
      // this paragraph's request is still in flight.
      let slow = 0;
      h.mockGoogle(async () => {
        slow += 1;
        await sleep(1500);
        slow -= 1;
        return undefined;
      });
      await h.evaluate(`(() => {
        const p = document.createElement('p');
        p.id = 'fresh';
        p.textContent = 'A lighthouse beam sweeps across the quiet bay after midnight.';
        document.querySelector('#intro').after(p);
      })()`);
      await waitFor(() => slow > 0, { message: 'the fresh paragraph to be in flight' });

      // Stop and start in the same breath; the paragraph now gets the quick service.
      const [stopped, started] = await Promise.all([h.tell('page.stop'), h.tell('page.start')]);
      expect(stopped).toMatchObject({ ok: true });
      expect(started).toMatchObject({ ok: true });
      h.mockGoogle();

      await waitFor(
        async () =>
          (await state()).translated >= 9 &&
          (await h.evaluate<boolean>(`!!document.querySelector('#fresh > et-tr')`)),
        { message: 'the restarted session to translate the first screen and the fresh paragraph' },
      );
      // The stopped session's requests were cancelled with it, so no late answer reaches the
      // page; this waits for them to settle, then checks the result is the restarted session's.
      await waitFor(() => slow === 0, { message: 'the slow requests to be answered' });
      const final = await state();
      expect(final).toMatchObject({ mode: 'translation', failed: 0 });
      expect(final.phase).toMatch(/running|done/);
      expect(final.engineError).toBeUndefined();
      const { perBlock, total } = await translations();
      expect(perBlock).toEqual(perBlock.map(() => 1));
      expect(total).toBe(final.translated);
      // Readable: the translation kept its size and the original is hidden.
      expect(
        await h.evaluate(`(() => {
          const root = document.querySelector('#intro');
          return {
            only: root.hasAttribute('data-et-only'),
            size: getComputedStyle(root.querySelector(':scope > et-tr')).fontSize,
          };
        })()`),
      ).toEqual({ only: true, size: '15px' });
      h.assertNoErrors();
    } finally {
      await setPageMode('bilingual');
    }
  });

  // Last in the file: it stops the worker.
  it('keeps translating new text after the service worker was stopped', async () => {
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).translated >= 8, {
      message: 'the first screen to be translated',
    });
    await waitFor(async () => (await state()).phase === 'done', { message: 'the page to settle' });

    // The first screen is cached now, so only fresh text proves a working request path.
    await h.stopServiceWorker();
    const before = h.google.count;
    await h.evaluate(`(() => {
      const p = document.createElement('p');
      p.id = 'fresh';
      p.textContent = 'A lighthouse beam sweeps across the quiet bay after midnight.';
      document.querySelector('#intro').after(p);
    })()`);
    await waitFor(
      () =>
        h.evaluate<boolean>(
          `document.querySelector('#fresh > et-tr')?.textContent.includes('【MOCK】') ?? false`,
        ),
      { message: 'the new paragraph to be translated through the restarted worker' },
    );
    expect(h.google.count).toBeGreaterThan(before);
    expect(h.google.texts.some((text) => text.includes('lighthouse beam'))).toBe(true);
    h.assertNoErrors();
  });
});
