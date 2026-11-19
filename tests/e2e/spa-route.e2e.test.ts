import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// M3d E: single-page-app route changes (docs/plans/m3d.md, docs/plans/spa-route-cooldown.md). A tiny router in the page's main
// world swaps the content of <main> on pushState and popstate, as a framework would; the
// session must translate the new route, forget the old one and count only what is on show.
// Each case starts from an empty cache.

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
});

beforeEach(() => prepare(h, { clearCache: true }));

afterAll(() => h?.close());

const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A paragraph is its marker word (unique, so requests and translations can be traced) plus text. */
type Para = [mark: string, text: string];
const LONG_TEXT = 'word '.repeat(1100);
const ROUTES: Record<string, Para[]> = {
  '/home': [
    ['homealpha', 'The harbour wakes up slowly when the fishing boats return.'],
    ['homebravo', 'A baker on the corner sells bread to the early walkers.'],
    ['homecharlie', 'Gulls circle the market square long before it opens.'],
  ],
  '/next': [
    ['nextdelta', 'The museum on the hill keeps a model of every ship.'],
    ['nextecho', 'Its curator explains the rigging to anyone who asks.'],
    ['nextfoxtrot', 'Children press their faces against the glass cases.'],
    ['nextgolf', 'A small cafe serves tea in the old customs office.'],
  ],
  '/long': [
    ['longhotel', LONG_TEXT],
    ['longindia', 'A short note follows the very long chapter above.'],
  ],
  '/long2': [
    ['longjuliet', LONG_TEXT],
    ['longkilo', 'Another short note after a second very long chapter.'],
  ],
  '/many1': Array.from(
    { length: 40 },
    (_, i): Para => [
      `manya${String(i).padStart(2, '0')}`,
      `Card ${i} describes one more exhibit in the western hall.`,
    ],
  ),
  '/many2': Array.from(
    { length: 40 },
    (_, i): Para => [
      `manyb${String(i).padStart(2, '0')}`,
      `Card ${i} lists one more ship model in the eastern hall.`,
    ],
  ),
  ...Object.fromEntries(
    ['c', 'd'].map((k, n) => [
      `/many${n + 3}`,
      Array.from(
        { length: 40 },
        (_, i): Para => [
          `many${k}${String(i).padStart(2, '0')}`,
          `Card ${i} names one more painting in room ${k} of the gallery.`,
        ],
      ),
    ]),
  ),
  '/third': [
    ['thirdlima', 'The ferry timetable changes with the seasons.'],
    ['thirdmike', 'Winter crossings are rare and often cancelled.'],
  ],
};
const TAGLINE = 'taglinemark';
const marksOf = (path: string) => (ROUTES[path] ?? []).map(([mark]) => mark);
const isLong = (mark: string) =>
  Object.values(ROUTES).some((paras) =>
    paras.some(([m, text]) => m === mark && text === LONG_TEXT),
  );
const ALL_MARKS = [TAGLINE, ...Object.values(ROUTES).flatMap((paras) => paras.map(([m]) => m))];

/**
 * Opens a page with a nav (never translated), a stable header line and <main>, plus a router:
 * `__go(path, how)` pushes the path and renders it, `how` being `children` (replaceChildren),
 * `element` (a new <main> replaces the old one) or `text` (the same <p>s keep their places and
 * only their text nodes change, as React does; extra or missing paragraphs are added or removed).
 * popstate renders the path it lands on with `children`.
 */
async function openApp(first: string) {
  await h.openPage('e2e-article.html');
  await h.evaluate(`(() => {
    const routes = ${JSON.stringify(ROUTES)};
    document.body.innerHTML =
      '<nav id="nav"><a href="/home">Home</a> <a href="/next">Next</a></nav>'
      + '<header id="site"><p id="tagline" data-mark="${TAGLINE}">${TAGLINE} A stable tagline that stays on every route of this little app.</p></header>'
      + '<main id="app"></main>';
    const para = ([mark, text]) => {
      const p = document.createElement('p');
      p.dataset.mark = mark;
      p.textContent = mark + ' ' + text;
      return p;
    };
    const render = (path, how) => {
      const paras = routes[path] ?? [];
      const main = document.querySelector('main');
      if (how === 'element') {
        const next = document.createElement('main');
        next.id = 'app';
        next.append(...paras.map(para));
        main.replaceWith(next);
      } else if (how === 'text') {
        const old = [...main.querySelectorAll(':scope > p')];
        paras.forEach(([mark, text], i) => {
          const p = old[i];
          if (!p) return main.append(para([mark, text]));
          p.dataset.mark = mark;
          const node = [...p.childNodes].find((n) => n.nodeType === 3);
          node.data = mark + ' ' + text;
        });
        for (const p of old.slice(paras.length)) p.remove();
      } else {
        main.replaceChildren(...paras.map(para));
      }
    };
    window.__go = (path, how = 'children') => {
      history.pushState({ path }, '', path);
      render(path, how);
    };
    addEventListener('popstate', () => render(location.pathname, 'children'));
    history.replaceState({ path: ${JSON.stringify(first)} }, '', ${JSON.stringify(first)});
    render(${JSON.stringify(first)}, 'children');
  })()`);
}

const go = (path: string, how: 'children' | 'element' | 'text' = 'children') =>
  h.evaluate(`window.__go(${JSON.stringify(path)}, ${JSON.stringify(how)})`);

interface View {
  path: string;
  /** The header line and every paragraph of <main>, in order. */
  paras: { mark: string; only: boolean; trs: { state: string | null; text: string }[] }[];
  /** Every <et-tr> in the document, with the marker of the paragraph holding it. */
  all: { parent: string; state: string | null; text: string }[];
}
const view = () =>
  h.evaluate<View>(`(() => {
    const tr = (t) => ({ state: t.getAttribute('data-et-state'), text: t.textContent });
    return {
      path: location.pathname,
      paras: [...document.querySelectorAll('#tagline, main > p')].map((p) => ({
        mark: p.dataset.mark,
        only: p.hasAttribute('data-et-only'),
        trs: [...p.querySelectorAll(':scope > et-tr')].map(tr),
      })),
      all: [...document.querySelectorAll('et-tr')].map((t) => ({
        parent: t.parentElement?.dataset.mark ?? t.parentElement?.localName ?? '',
        ...tr(t),
      })),
    };
  })()`);

/**
 * What a settled route looks like: the header line and each paragraph of `path` hold exactly
 * one <et-tr>, a translation of their own text (a "too long" note for a long one), and the
 * page holds no other <et-tr>. Returns the problems (empty when settled).
 */
function problems(v: View, path: string): string[] {
  const out: string[] = [];
  const marks = [TAGLINE, ...marksOf(path)];
  const seen = v.paras.map((p) => p.mark);
  if (JSON.stringify(seen) !== JSON.stringify(marks)) out.push(`paragraphs ${seen.join(',')}`);
  for (const p of v.paras) {
    const want = isLong(p.mark) ? 'skipped' : null;
    if (p.trs.length !== 1) out.push(`${p.mark}: ${p.trs.length} et-tr`);
    const [only] = p.trs;
    if (only && only.state !== want) out.push(`${p.mark}: state ${only.state}`);
    if (only && want === null && !only.text.includes(`【MOCK】${p.mark.toUpperCase()}`)) {
      out.push(`${p.mark}: text ${only.text.slice(0, 60)}`);
    }
  }
  for (const t of v.all) {
    if (!marks.includes(t.parent)) out.push(`orphan et-tr in ${t.parent}`);
    const foreign = ALL_MARKS.filter((m) => m !== t.parent && t.text.includes(m.toUpperCase()));
    if (foreign.length > 0) out.push(`et-tr in ${t.parent} carries ${foreign.join(',')}`);
  }
  if (v.all.length !== marks.length) out.push(`${v.all.length} et-tr for ${marks.length} blocks`);
  return out;
}

/** Waits until `path` is settled on the page and in the session, then checks the count. */
async function settle(path: string) {
  let last: string[] = [];
  await waitFor(
    async () => {
      last = problems(await view(), path);
      return last.length === 0 && (await state()).phase === 'done';
    },
    { message: `${path} to be translated` },
  ).catch((error: Error) => {
    throw new Error(`${error.message}\nproblems: ${last.join('; ')}`);
  });
  const longs = marksOf(path).filter(isLong).length;
  const final = await state();
  expect(final).toMatchObject({ translated: 1 + marksOf(path).length - longs, failed: 0 });
  expect(final.skipped).toBe(longs > 0 ? longs : undefined);
  expect(final.engineError).toBeUndefined();
}

/** Texts sent to the service from `from` on (an index into h.google.texts). */
const sentSince = (from: number) => h.google.texts.slice(from);
const mentions = (texts: string[], path: string) =>
  marksOf(path).filter((mark) => texts.some((text) => text.includes(mark)));

/** Names of every et-* element and data-et-* attribute left in the document. */
const leftovers = () =>
  h.evaluate<string[]>(`[...document.querySelectorAll('*')].flatMap((el) => [
    ...(el.localName.startsWith('et-') ? [el.localName] : []),
    ...el.getAttributeNames().filter((n) => n.startsWith('data-et-')).map((n) => el.localName + '@' + n),
    ...(el.closest('main, header') && el.hasAttribute('style') ? [el.localName + '@style'] : []),
  ])`);

async function stopAndCheckClean() {
  await h.tell('page.toggle');
  await waitFor(async () => (await state()).phase === 'idle', { message: 'the session to stop' });
  await waitFor(async () => (await leftovers()).length === 0, {
    message: 'nothing of ours to be left on the page',
  });
}

describe('single-page route changes', () => {
  it('a. translates new paragraphs after pushState + main.replaceChildren and forgets the old ones', async () => {
    await openApp('/home');
    await h.tell('page.toggle');
    await settle('/home');

    const from = h.google.texts.length;
    await go('/next', 'children');
    await settle('/next');
    // A quiet moment more: nothing of the old route is sent late, the count does not drift.
    await sleep(800);
    expect(mentions(sentSince(from), '/home')).toEqual([]);
    expect(mentions(sentSince(from), '/next')).toEqual(marksOf('/next'));
    await settle('/next');
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it('b. translates a new <main> that replaced the old element', async () => {
    await openApp('/home');
    await h.tell('page.toggle');
    await settle('/home');

    const from = h.google.texts.length;
    await go('/next', 'element');
    await settle('/next');
    await sleep(800);
    expect(mentions(sentSince(from), '/home')).toEqual([]);
    // The header line was kept, not translated again.
    expect(sentSince(from).some((text) => text.includes(TAGLINE))).toBe(false);
    await settle('/next');
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it("c. counts only the current route's too-long paragraph, and none once it is gone", async () => {
    await openApp('/long');
    await h.tell('page.toggle');
    await settle('/long');

    await go('/long2', 'children');
    await settle('/long2');
    expect(h.google.texts.some((text) => text.includes('longhotel'))).toBe(false);
    expect(h.google.texts.some((text) => text.includes('longjuliet'))).toBe(false);

    await go('/third', 'children');
    await settle('/third');
    expect('skipped' in (await state())).toBe(false);
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it('d. drops a late answer for the old route that arrives after the switch', async () => {
    // The first route's request is held until the route has changed.
    let slow = 0;
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    h.mockGoogle(async (text) => {
      if (!marksOf('/home').some((mark) => text.includes(mark))) return undefined;
      slow += 1;
      await gate;
      slow -= 1;
      return undefined;
    });
    try {
      await openApp('/home');
      await h.tell('page.toggle');
      await waitFor(() => slow > 0, { message: 'the first route to be in flight' });

      await go('/next', 'children');
      // The new route does not wait for the old request.
      await waitFor(
        async () => {
          const { paras } = await view();
          return marksOf('/next').every((mark) => {
            const [only, ...rest] = paras.find((p) => p.mark === mark)?.trs ?? [];
            return only !== undefined && rest.length === 0 && only.state === null;
          });
        },
        { message: 'the new route to be translated while the old request hangs' },
      );
      release();
      await waitFor(() => slow === 0, { message: 'the old request to be answered' });
      // Time for the late answer to reach the page, if it were going to.
      await sleep(500);
      await settle('/next');
      h.assertNoErrors();
      await stopAndCheckClean();
    } finally {
      release();
    }
  });

  it('e. translates the old content again when popstate brings it back', async () => {
    await openApp('/home');
    await h.tell('page.toggle');
    await settle('/home');
    await go('/next', 'children');
    await settle('/next');

    const from = h.google.texts.length;
    await h.evaluate('history.back()');
    await waitFor(() => h.evaluate<boolean>(`location.pathname === '/home'`), {
      message: 'popstate to land on /home',
    });
    await settle('/home');
    // From memory: the session already knows these texts.
    expect(mentions(sentSince(from), '/home')).toEqual([]);
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it('f. keeps translation-only on the new route, with nothing left behind', async () => {
    await openApp('/home');
    await h.tell('page.toggle');
    await settle('/home');
    expect(await h.tell('page.setMode', 'translation')).toMatchObject({ ok: true });
    await waitFor(async () => (await view()).paras.every((p) => p.only), {
      message: 'translation-only on the first route',
    });

    await go('/next', 'children');
    await settle('/next');
    await waitFor(async () => (await view()).paras.every((p) => p.only), {
      message: 'translation-only on the new route',
    });
    expect((await state()).mode).toBe('translation');
    // Readable: each translation kept the page's size; nothing else carries our marks.
    expect(
      await h.evaluate(
        `[...document.querySelectorAll('main > p > et-tr')].map((t) => getComputedStyle(t).fontSize)`,
      ),
    ).toEqual(marksOf('/next').map(() => '15px'));
    expect(
      await h.evaluate<number>(
        `document.querySelectorAll('[data-et-only]:not(#tagline, main > p)').length`,
      ),
    ).toBe(0);
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it('g. follows a framework that keeps the <p>s and only rewrites their text (translation-only)', async () => {
    await openApp('/home');
    await h.tell('page.toggle');
    await settle('/home');
    expect(await h.tell('page.setMode', 'translation')).toMatchObject({ ok: true });
    await waitFor(async () => (await view()).paras.every((p) => p.only), {
      message: 'translation-only on the first route',
    });

    const from = h.google.texts.length;
    await go('/next', 'text');
    await settle('/next');
    await waitFor(async () => (await view()).paras.every((p) => p.only), {
      message: 'translation-only on the rewritten paragraphs',
    });
    expect(mentions(sentSince(from), '/home')).toEqual([]);
    // Fewer paragraphs again: the reused ones keep working, the removed one is forgotten.
    await go('/third', 'text');
    await settle('/third');
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it('h. survives quick back-and-forth between two routes without giving up on their text', async () => {
    await openApp('/home');
    await h.tell('page.toggle');
    await settle('/home');
    for (let round = 0; round < 3; round += 1) {
      await go('/next', 'children');
      await settle('/next');
      await h.evaluate('history.back()');
      await settle('/home');
    }
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it('i. follows a route that rewrites more paragraphs than one mutation round takes (burst)', async () => {
    await openApp('/many1');
    await h.tell('page.toggle');
    await settle('/many1');
    const from = h.google.texts.length;
    await go('/many2', 'text');
    await settle('/many2');
    expect(mentions(sentSince(from), '/many1')).toEqual([]);
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it('j. a run of big routes is not slowed down by the whole-page cooldown', async () => {
    // Each route rewrites 40 paragraphs in place (more than one mutation round takes), and
    // the next one follows the moment the last is translated. The first request of a route
    // must not wait for a cooldown that has grown with the routes before it (1s, 2s, 4s).
    const firstSeen = new Map<string, number>();
    h.mockGoogle((text) => {
      for (const prefix of ['manyb', 'manyc', 'manyd']) {
        if (text.includes(prefix) && !firstSeen.has(prefix)) firstSeen.set(prefix, Date.now());
      }
      return undefined;
    });
    await openApp('/many1');
    await h.tell('page.toggle');
    await settle('/many1');
    const waits: number[] = [];
    for (const path of ['/many2', '/many3', '/many4']) {
      const prefix = (marksOf(path)[0] ?? '').slice(0, 5);
      const start = Date.now();
      await go(path, 'text');
      await waitFor(() => firstSeen.has(prefix), { message: `the first request of ${path}` });
      waits.push((firstSeen.get(prefix) ?? start) - start);
      await settle(path);
    }
    // The first route has no cooldown at all; the next two used to wait about 1950 and 3900.
    expect(waits[1], `first request after the go, per route: ${waits.join(', ')} ms`).toBeLessThan(
      1500,
    );
    expect(waits[2], `first request after the go, per route: ${waits.join(', ')} ms`).toBeLessThan(
      1500,
    );
    h.assertNoErrors();
    await stopAndCheckClean();
  });

  it('l. puts back translations a framework removed, from memory and without a request', async () => {
    await openApp('/home');
    await h.tell('page.toggle');
    await settle('/home');
    const from = h.google.texts.length;
    await h.evaluate(`document.querySelector('main > p > et-tr').remove()`);
    await settle('/home');
    await h.evaluate(`document.querySelectorAll('et-tr').forEach((t) => t.remove())`);
    await settle('/home');
    expect(sentSince(from)).toEqual([]);
    h.assertNoErrors();
    await stopAndCheckClean();
  });
});
