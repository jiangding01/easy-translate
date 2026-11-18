import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// P0-3b: translation-only keeps the layout of tests/fixtures/translation-only-layout.html
// (auto margins, percentage padding, em spacing, ch / em lengths) when the window is resized.
// The "known limitation" sections of the fixture are left out on purpose.

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
  await prepare(h, { clearCache: true });
});

afterAll(() => h?.close());

const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
const setMode = (mode: string) => h.tell<Ok<PageState>>('page.setMode', mode);

/** The fixture's paragraphs that must keep their layout, one per case. */
const BOXES = [
  '.centred',
  '.padded',
  '.spaced',
  '.measure',
  '.sized',
  '.row > p:nth-child(1)',
  '.row > p:nth-child(2)',
];
const TOLERANCE = 0.5;
/** Pinned at this width, then measured at the narrower one. */
const WIDE = 1100;
const NARROW = 700;
/** Tall enough for the whole page to count as on screen. */
const HEIGHT = 3000;

interface Box {
  width: number;
  left: number;
  /** The content box: a percentage padding pinned to pixels moves it, not the border box. */
  contentWidth: number;
  contentLeft: number;
}

/** Border and content boxes of each tested paragraph (the element itself, not its translation). */
const boxes = () =>
  h.evaluate<Box[]>(`${JSON.stringify(BOXES)}.map((selector) => {
    const element = document.querySelector(selector);
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const start = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const end = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth);
    return {
      width: rect.width,
      left: rect.left,
      contentWidth: rect.width - start - end,
      contentLeft: rect.left + start,
    };
  })`);

function expectSameBoxes(actual: Box[], expected: Box[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, box] of expected.entries()) {
    const label = BOXES[index];
    expect(Math.abs((actual[index]?.width ?? 0) - box.width), `${label} width`).toBeLessThanOrEqual(
      TOLERANCE,
    );
    expect(Math.abs((actual[index]?.left ?? 0) - box.left), `${label} left`).toBeLessThanOrEqual(
      TOLERANCE,
    );
    expect(
      Math.abs((actual[index]?.contentWidth ?? 0) - box.contentWidth),
      `${label} content width`,
    ).toBeLessThanOrEqual(TOLERANCE);
    expect(
      Math.abs((actual[index]?.contentLeft ?? 0) - box.contentLeft),
      `${label} content left`,
    ).toBeLessThanOrEqual(TOLERANCE);
  }
}

describe('translation-only layout', () => {
  it('keeps auto margins, percentage padding and em spacing when the window is resized', async () => {
    try {
      await h.setViewport(NARROW, HEIGHT);
      await h.openPage('translation-only-layout.html');
      // The untranslated page at the narrow width: what both modes must give back.
      const original = await boxes();
      const spacing = await h.evaluate<{ letter: string; word: string }>(`(() => {
        const style = getComputedStyle(document.querySelector('.spaced'));
        return { letter: style.letterSpacing, word: style.wordSpacing };
      })()`);
      expect(spacing.letter).not.toBe('normal');

      // Translate and switch to translation-only at the wide width, so the pins are taken there.
      await h.setViewport(WIDE, HEIGHT);
      await h.tell('page.toggle');
      await waitFor(
        () =>
          h.evaluate<boolean>(`${JSON.stringify(BOXES)}.every((selector) =>
            document.querySelector(selector).querySelector(':scope > et-tr')?.textContent.includes('【MOCK】'))`),
        { message: 'every tested paragraph to be translated' },
      );
      expect(await setMode('translation')).toMatchObject({
        ok: true,
        data: { mode: 'translation' },
      });
      await waitFor(
        () =>
          h.evaluate<boolean>(`${JSON.stringify(BOXES)}.every((selector) =>
            document.querySelector(selector).hasAttribute('data-et-only'))`),
        { message: 'every tested paragraph to be translation-only' },
      );

      // Narrower window: the boxes must follow it as the untranslated page does.
      await h.setViewport(NARROW, HEIGHT);
      await waitFor(async () => (await h.evaluate<number>('innerWidth')) === NARROW, {
        message: 'the narrow viewport',
      });
      expectSameBoxes(await boxes(), original);
      // The translation keeps the original's letter and word spacing (em lengths of a root
      // whose font size is zero).
      expect(
        await h.evaluate(`(() => {
          const style = getComputedStyle(document.querySelector('.spaced > et-tr'));
          return { letter: style.letterSpacing, word: style.wordSpacing };
        })()`),
      ).toEqual(spacing);

      // Back to bilingual: the original layout is whole again.
      expect(await setMode('bilingual')).toMatchObject({ ok: true, data: { mode: 'bilingual' } });
      await waitFor(() => h.evaluate(`!document.querySelector('[data-et-only]')`), {
        message: 'the original to be shown again',
      });
      expectSameBoxes(await boxes(), original);
      expect((await state()).translated).toBeGreaterThan(0);
      h.assertNoErrors();
    } finally {
      await h.clearViewport();
    }
  });
});
