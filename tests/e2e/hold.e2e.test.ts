import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// M3b PR4: holding Ctrl over a paragraph of a translated page toggles that paragraph. Real
// key and mouse events through CDP; the gesture's finer rules are unit-tested (hold/watch).

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
});

beforeEach(() => prepare(h, { clearCache: true }));

afterAll(() => h?.close());

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
/** CDP modifier bit for Ctrl. */
const CTRL = 2;
const CONTROL = { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 };

/** Translations directly inside the block (not loading dots). */
const translationsIn = (selector: string) =>
  h.evaluate<number>(
    `document.querySelectorAll(${JSON.stringify(`${selector} > et-tr:not([data-et-state])`)}).length`,
  );

/** The middle of the block's first line of source text. */
const pointOn = (selector: string) =>
  h.evaluate<{ x: number; y: number }>(`(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(${JSON.stringify(selector)}).firstChild);
    const r = range.getClientRects()[0];
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

const move = (point: { x: number; y: number }, modifiers = 0) =>
  h.input('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', modifiers });
const ctrl = (type: 'rawKeyDown' | 'keyUp') =>
  h.input('Input.dispatchKeyEvent', { type, ...CONTROL, modifiers: type === 'keyUp' ? 0 : CTRL });

/**
 * The pointer rests on the paragraph and Ctrl is held until the paragraph shows `count`
 * translations (at most 3 s), then released: no fixed hold length to race against.
 */
async function hold(selector: string, count: number) {
  await move(await pointOn(selector));
  await ctrl('rawKeyDown');
  try {
    await waitFor(async () => (await translationsIn(selector)) === count, {
      timeout: 3000,
      interval: 50,
      message: `${selector} to show ${count} translation(s) while Ctrl is held`,
    });
  } finally {
    await ctrl('keyUp');
  }
}

async function translatedPage() {
  await h.openPage('e2e-article.html');
  await h.tell('page.toggle');
  await waitFor(async () => (await state()).translated >= 8 && (await translationsIn('#intro')), {
    message: 'the first screen to be translated',
  });
}

describe('hold Ctrl to toggle a paragraph', () => {
  it('removes the translation, then brings it back on the next hold', async () => {
    await translatedPage();
    const before = (await state()).translated;
    await hold('#intro', 0);
    expect((await state()).translated).toBe(before - 1);
    // The neighbours keep theirs.
    expect(await translationsIn('#linked')).toBe(1);

    await hold('#intro', 1);
    expect((await state()).translated).toBe(before);
    h.assertNoErrors();
  });

  it('does nothing for Ctrl+C pressed within 100 ms', async () => {
    await translatedPage();
    await move(await pointOn('#intro'));
    await ctrl('rawKeyDown');
    await sleep(60);
    const c = { key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: CTRL };
    await h.input('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...c });
    await h.input('Input.dispatchKeyEvent', { type: 'keyUp', ...c });
    await sleep(600);
    await ctrl('keyUp');
    await sleep(200);
    expect(await translationsIn('#intro')).toBe(1);
    h.assertNoErrors();
  });

  it('keeps a restored paragraph untranslated through new content and scrolling', async () => {
    await translatedPage();
    await hold('#intro', 0);

    // Away past the viewport margin and back, then new content next to the restored paragraph
    // (its block is rescanned): each step waits for a positive sign that it was processed.
    await h.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await waitFor(() => translationsIn('#far-1'), { message: 'the far paragraphs to translate' });
    await h.evaluate('window.scrollTo(0, 0)');
    await h.evaluate(`document.querySelector('#intro').insertAdjacentHTML('afterend',
      '<p id="added">A new paragraph about the evening market by the water.</p>')`);
    await waitFor(() => translationsIn('#added'), { message: 'the new paragraph to translate' });

    expect(await translationsIn('#intro')).toBe(0);
    expect(await translationsIn('#linked')).toBe(1);
    h.assertNoErrors();
  });
});
