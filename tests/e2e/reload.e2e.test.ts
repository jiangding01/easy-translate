import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// P0-15 (docs/plans/e2e-reload-extension.md): the extension reloads (an update) while a page is
// open. The old content script is cut off; the page must stay quiet: no errors, no half-written
// text, the isle gone, and what was translated stays. A new load of the page works again.

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
  for (const release of releases.splice(0)) release();
  h.mockGoogle();
});

const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
const has = (selector: string) => h.evaluate<boolean>(`!!document.querySelector('${selector}')`);
const count = (selector: string) =>
  h.evaluate<number>(`document.querySelectorAll('${selector}').length`);
const TRANSLATIONS = 'et-tr:not([data-et-state])';
const DOT = 'et-tr[data-et-state="loading"]';

/** The first screen is translated and the session has settled. */
async function translateFully() {
  await h.openPage('e2e-article.html');
  await h.tell('page.toggle');
  await waitFor(async () => (await state()).translated >= 8, {
    message: 'the first screen to be translated',
  });
  await waitFor(async () => (await state()).phase === 'done', {
    message: 'the page to settle',
  });
}

/** A trusted click on `selector` inside the isle's shadow root, once it has stopped moving. */
async function clickInIsle(selector: string) {
  const where = () =>
    h.shadow<{ x: number; y: number } | null>(
      'et-isle',
      `(root) => {
        const r = root.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
        return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      }`,
    );
  const point = await waitFor(
    async () => {
      const before = await where();
      await new Promise((done) => setTimeout(done, 200));
      const after = await where();
      return before && after && before.x === after.x && before.y === after.y ? after : null;
    },
    { message: `${selector} in the isle to hold still` },
  );
  await h.trustedClick(point);
}

describe('extension reload with a page open', () => {
  it('stops quietly when the extension reloads in the middle of a translation', async () => {
    await h.openPage('e2e-article.html');
    const original = await h.evaluate<string>(`document.querySelector('#article').textContent`);
    const release = slowGoogle();
    await h.tell('page.toggle');
    await waitFor(async () => h.google.count > 0 && (await has(DOT)) && (await has('et-isle')), {
      message: 'a request in flight, a loading dot and the isle',
    });

    await h.reloadExtension();
    release();

    // The content script notices it is cut off: the dots go and so does the isle.
    await waitFor(async () => !(await has(DOT)) && !(await has('et-isle')), {
      message: 'the loading dots and the isle to go after the reload',
    });
    expect(await count('et-tr')).toBe(0);
    expect(await h.evaluate<string>(`document.querySelector('#article').textContent`)).toBe(
      original,
    );
    h.assertNoErrors();
  });

  it('leaves the page alone when it changes after the reload', async () => {
    await translateFully();
    const translated = await count(TRANSLATIONS);
    expect(translated).toBeGreaterThanOrEqual(8);

    await h.reloadExtension();
    const requests = h.google.count;
    await h.evaluate(`(() => {
      const p = document.createElement('p');
      p.id = 'late';
      p.textContent = 'A late paragraph that nobody is going to translate any more.';
      document.querySelector('#intro').after(p);
      window.scrollBy(0, 40);
    })()`);

    await waitFor(() => h.evaluate<boolean>(`!document.querySelector('et-isle')`), {
      message: 'the isle to go after the page changed',
    });
    expect(await count(TRANSLATIONS)).toBe(translated);
    expect(await has('#late > et-tr')).toBe(false);
    expect(h.google.count).toBe(requests);
    h.assertNoErrors();
  });

  it('drops the isle at the first click after the reload and keeps the translations', async () => {
    await translateFully();
    const translated = await count(TRANSLATIONS);
    await h.reloadExtension();
    // Nothing asked the extension anything since: the page does not know yet.
    expect(await has('et-isle')).toBe(true);

    await clickInIsle('.hit');
    await clickInIsle('[data-act="mode-1"]');

    await waitFor(() => h.evaluate<boolean>(`!document.querySelector('et-isle')`), {
      message: 'the isle to go after the click',
    });
    expect(await count(TRANSLATIONS)).toBe(translated);
    h.assertNoErrors();
  });

  it('translates a page opened after the reload', async () => {
    await translateFully();
    await h.reloadExtension();
    const requests = h.google.count;

    await h.openPage('e2e-article.html');
    await h.evaluate(`(() => {
      const p = document.createElement('p');
      p.id = 'fresh';
      p.textContent = 'A lighthouse beam sweeps across the quiet bay after the reload.';
      document.querySelector('#intro').before(p);
    })()`);
    await h.tell('page.toggle');
    await waitFor(
      () =>
        h.evaluate<boolean>(
          `!!document.querySelector('#fresh > et-tr')?.textContent.includes('【MOCK】')`,
        ),
      { message: 'the new text to be translated by the new worker' },
    );
    // Cached paragraphs prove nothing about the new worker: the fresh one went to the service.
    expect(h.google.count).toBeGreaterThan(requests);
    h.assertNoErrors();
  });
});
