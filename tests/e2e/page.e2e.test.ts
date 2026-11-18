import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';

// P0-2: whole-page translation of tests/fixtures/e2e-article.html with the Google mock.

/** Every block of #article that fits the first screen. */
const FIRST_SCREEN = ['#title', '#intro', '#linked', '#coded', '#list li', '#quote'];
const FAR = ['#far-1', '#far-2'];

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
  // Extension-page-only messages go through the settings page. The target is fixed, so the
  // result does not depend on the browser's own language.
  const options = await h.extPage('options.html');
  expect(
    await options.send('config.patch', [{ path: 'language.target', value: 'zh-CN' }]),
  ).toMatchObject({ ok: true });
  expect(await options.send('cache.clear')).toMatchObject({ ok: true });
  await options.close();
});

afterAll(() => h?.close());

/** How many of the elements matched by `selectors` carry a mock translation, of how many. */
function translated(selectors: string[]) {
  return h.evaluate<{ done: number; total: number }>(`(() => {
    const blocks = ${JSON.stringify(selectors)}.flatMap((s) => [...document.querySelectorAll(s)]);
    const done = blocks.filter((el) => el.querySelector('et-tr')?.textContent.includes('【MOCK】'));
    return { done: done.length, total: blocks.length };
  })()`);
}

describe('page translation', () => {
  it('translates the first screen, keeps links and code, shows the isle, then the rest on scroll', async () => {
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');

    await waitFor(
      async () => {
        const { done, total } = await translated(FIRST_SCREEN);
        return total === 8 && done === total;
      },
      { message: 'every first-screen block to be translated' },
    );
    expect(
      await h.evaluate(
        `!!document.querySelector('#linked et-tr a[href="https://example.com/harbour-weather"]')`,
      ),
    ).toBe(true);
    expect(await h.evaluate(`document.querySelector('#coded et-tr code')?.textContent`)).toBe(
      'harbour-pass',
    );
    await waitFor(
      () => h.evaluate(`document.documentElement.querySelector('et-isle')?.dataset.etRect`),
      { message: 'the isle (data-et-rect)' },
    );

    // Past the 1000px viewport margin: untranslated until scrolled into range.
    expect(await translated(FAR)).toEqual({ done: 0, total: 2 });
    await h.evaluate(`document.querySelector('#far').scrollIntoView()`);
    await waitFor(async () => (await translated(FAR)).done === 2, {
      message: 'the far paragraphs to be translated after scrolling',
    });

    expect(h.google.count).toBeGreaterThan(0);
    h.assertNoErrors();
  });
});
