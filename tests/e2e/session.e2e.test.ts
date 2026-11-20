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

  it('keeps the engine it started with when the default engine changes afterwards', async () => {
    await h.openPage('e2e-article.html');
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).translated >= 8, {
      message: 'the first screen to be translated',
    });
    await waitFor(async () => (await state()).phase === 'done', { message: 'the page to settle' });

    // DeepSeek has no key: a session that followed the default would pause or fail.
    const options = await h.extPage('options.html');
    try {
      expect(
        await options.send('config.patch', [{ path: 'translation.engine', value: 'deepseek' }]),
      ).toMatchObject({ ok: true });
      const text = 'A pinned engine carries the harbour bell across the water.';
      await h.evaluate(`(() => {
        const p = document.createElement('p');
        p.id = 'latecomer';
        p.textContent = ${JSON.stringify(text)};
        document.querySelector('#intro').after(p);
      })()`);
      await waitFor(
        () =>
          h.evaluate<boolean>(
            `document.querySelector('#latecomer > et-tr')?.textContent.includes('【MOCK】') ?? false`,
          ),
        { message: 'the new paragraph to be translated by the session engine' },
      );
      expect(h.google.texts.some((item) => item.includes('harbour bell'))).toBe(true);
      expect((await state()).engineError).toBeUndefined();
      h.assertNoErrors();
    } finally {
      expect(
        await options.send('config.patch', [{ path: 'translation.engine', value: 'google' }]),
      ).toMatchObject({ ok: true });
      await options.close();
    }
  });

  // Content that lands while the first scan is yielding to the page. The yield is wrapped
  // in the content script's own world (the page cannot see it), so the insertion happens at
  // a known point of the scan; the page has thousands of blocks so the scan yields at all.
  describe('during the first scan', () => {
    const BULK = 6000;
    async function bigPage(insert: string) {
      await h.openPage('e2e-article.html');
      await h.evaluate(`(() => {
        document.body.innerHTML = '<div id="top"><p id="early">The first small container.</p></div>'
          + '<main id="bulk">' + Array.from({ length: ${BULK} }, (_, i) =>
            '<p>Paragraph number ' + i + ' of a very long page.</p>').join('') + '</main>';
      })()`);
      await h.evalInContentWorld(`(() => {
        const real = globalThis.scheduler.yield.bind(globalThis.scheduler);
        globalThis.__yields = 0;
        globalThis.scheduler.yield = () => {
          globalThis.__yields += 1;
          if (globalThis.__yields === 1) {
            globalThis.__trAtInsert = document.querySelectorAll('et-tr').length;
            ${insert}
          }
          return real();
        };
      })()`);
      await h.tell('page.toggle');
    }
    const translated = (selector: string) =>
      h.evaluate<boolean>(
        `document.querySelector(${JSON.stringify(selector)} + ' > et-tr')?.textContent.includes('【MOCK】') ?? false`,
      );
    const insertedMidScan = () =>
      h.evalInContentWorld<{ yields: number; trAtInsert: number }>(
        '({ yields: globalThis.__yields, trAtInsert: globalThis.__trAtInsert })',
      );

    it('translates a paragraph added to a container the scan had already passed', async () => {
      await bigPage(`(() => {
        const p = document.createElement('p');
        p.id = 'late';
        p.textContent = 'A paragraph that arrived while the page was still being scanned.';
        document.getElementById('top').append(p);
      })();`);
      await waitFor(() => translated('#late'), {
        message: 'the paragraph added during the scan to be translated',
        timeout: 20_000,
      });
      expect(await translated('#early')).toBe(true);
      // The insertion really came before any translation: the scan was still going.
      expect(await insertedMidScan()).toMatchObject({ trAtInsert: 0 });
      h.assertNoErrors();
    });

    it('translates blocks added in front of the page as two paragraphs', async () => {
      await bigPage(`document.body.insertAdjacentHTML('afterbegin',
        '<div id="pre"><div id="pa">First prepended block text.</div>'
        + '<div id="pb">Second prepended block text.</div></div>');`);
      await waitFor(async () => (await translated('#pa')) && (await translated('#pb')), {
        message: 'both prepended blocks to be translated',
        timeout: 20_000,
      });
      expect(await insertedMidScan()).toMatchObject({ trAtInsert: 0 });
      // Each block on its own: nothing was sent as one unit around both.
      expect(
        h.google.texts.some((text) => text.includes('First prepended') && text.includes('Second')),
      ).toBe(false);
      expect(await h.evaluate<number>("document.querySelectorAll('body > et-tr').length")).toBe(0);
      h.assertNoErrors();
    });
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

  it('sends nothing for a block that holds only code', async () => {
    await h.openPage('e2e-article.html');
    await h.evaluate(`(() => {
      document.body.innerHTML = '<div id="box">'
        + '<p id="code"><code>zeppelincode --flag</code></p>'
        + '<p id="plain">A short ordinary paragraph about the harbour.</p>'
        + '</div>';
    })()`);
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).translated >= 1, {
      message: 'the ordinary paragraph to be translated',
    });
    expect(h.google.texts.some((text) => text.includes('zeppelincode'))).toBe(false);
    expect(await h.evaluate<boolean>(`!!document.querySelector('#code > et-tr')`)).toBe(false);
    h.assertNoErrors();
  });

  it('marks a paragraph too long to translate, counts it, and never sends its text', async () => {
    await h.openPage('e2e-article.html');
    const marker = 'zeppelinmarker';
    await h.evaluate(`(() => {
      document.body.innerHTML = '<div id="box">'
        + '<p id="long">' + ${JSON.stringify(marker)} + ' ' + 'word '.repeat(1200) + '</p>'
        + '<p id="url">https://example.com/' + 'a'.repeat(6000) + '</p>'
        + '<p id="plain">A short ordinary paragraph about the harbour.</p>'
        + '</div>';
    })()`);
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).skipped === 1, {
      message: 'the too-long paragraph to be counted',
    });
    const notes = () =>
      h.evaluate<number>(`document.querySelectorAll('et-tr[data-et-state="skipped"]').length`);
    await waitFor(async () => (await notes()) === 1, { message: 'the note to be written' });
    await waitFor(async () => (await state()).translated >= 1, {
      message: 'the ordinary paragraph to be translated',
    });
    expect(h.google.texts.some((text) => text.includes(marker))).toBe(false);
    expect(h.google.texts.some((text) => text.includes('example.com'))).toBe(false);

    // Translation-only: the long paragraph's original stays, the ordinary one is hidden.
    expect(await h.tell('page.setMode', 'translation')).toMatchObject({ ok: true });
    await waitFor(
      () => h.evaluate<boolean>(`document.querySelector('#plain').hasAttribute('data-et-only')`),
      { message: 'the ordinary paragraph to be hidden' },
    );
    expect(
      await h.evaluate<boolean>(`document.querySelector('#long').hasAttribute('data-et-only')`),
    ).toBe(false);
    expect(await h.tell('page.setMode', 'bilingual')).toMatchObject({ ok: true });

    // A paragraph added later does not change the count or the number of notes.
    await h.evaluate(`(() => {
      const p = document.createElement('p');
      p.id = 'later';
      p.textContent = 'A later paragraph about the lighthouse keeper.';
      document.querySelector('#plain').after(p);
    })()`);
    await waitFor(
      () => h.evaluate<boolean>(`!!document.querySelector('#later > et-tr[data-et-s]')`),
      { message: 'the later paragraph to be translated' },
    );
    expect((await state()).skipped).toBe(1);
    expect(await notes()).toBe(1);

    await h.tell('page.toggle');
    await waitFor(async () => !('skipped' in (await state())), {
      message: 'the count to go away on stop',
    });
    await waitFor(() => h.evaluate<boolean>(`document.querySelectorAll('et-tr').length === 0`), {
      message: 'the notes to be removed',
    });
    h.assertNoErrors();
  });

  it('keeps a status note on one line, inline after a long run and beside text in a flex box', async () => {
    await h.openPage('e2e-article.html');
    await h.evaluate(`(() => {
      const box = 'width:300px;font:10px/12px monospace;';
      document.body.innerHTML = '<div id="flexbox" style="display:flex;' + box + '">'
        + 'word '.repeat(1200) + '</div>'
        + '<div id="run" style="' + box + '">' + 'word '.repeat(1200) + 'y'.repeat(40)
        + '<div>A block child that ends the run.</div></div>';
    })()`);
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).skipped === 2, {
      message: 'both long texts to be counted',
    });
    await waitFor(
      () =>
        h.evaluate<boolean>(
          `document.querySelectorAll('et-tr[data-et-state="skipped"]').length === 2`,
        ),
      { message: 'both notes to be written' },
    );
    // Every line box of a note shares one top, so the note takes a single line.
    const tops = await h.evaluate<Record<string, number[]>>(`(() => {
      const out = {};
      for (const id of ['flexbox', 'run']) {
        const tr = document.querySelector('#' + id + ' > et-tr[data-et-state="skipped"]');
        const range = document.createRange();
        range.selectNodeContents(tr);
        out[id] = [...new Set([...range.getClientRects()].map((r) => Math.round(r.top)))];
      }
      return out;
    })()`);
    expect(tops.flexbox).toHaveLength(1);
    expect(tops.run).toHaveLength(1);
    h.assertNoErrors();
  });
});
