import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// M3b PR4: holding Ctrl over a paragraph of a translated page toggles that paragraph; PR5:
// with no page session it translates the held paragraph alone. Real key and mouse events
// through CDP; the gesture's finer rules are unit-tested (hold/watch).

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
});

beforeEach(() => prepare(h, { clearCache: true }));

afterAll(() => h?.close());

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
/** CDP modifier bits for Alt and Ctrl. */
const ALT = 1;
const CTRL = 2;
const CONTROL = { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 };
const ALT_KEY = { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 };

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
type KeyStep = (type: 'rawKeyDown' | 'keyUp') => Promise<unknown>;
const ctrl: KeyStep = (type) =>
  h.input('Input.dispatchKeyEvent', { type, ...CONTROL, modifiers: type === 'keyUp' ? 0 : CTRL });
const alt: KeyStep = (type) =>
  h.input('Input.dispatchKeyEvent', { type, ...ALT_KEY, modifiers: type === 'keyUp' ? 0 : ALT });

/**
 * The pointer rests on the paragraph and the key (Ctrl by default) is held until the
 * paragraph shows `count` translations (at most 3 s), then released: no fixed hold length
 * to race against.
 */
async function hold(selector: string, count: number, key = ctrl) {
  await move(await pointOn(selector));
  await key('rawKeyDown');
  try {
    await waitFor(async () => (await translationsIn(selector)) === count, {
      timeout: 3000,
      interval: 50,
      message: `${selector} to show ${count} translation(s) while the key is held`,
    });
  } finally {
    await key('keyUp');
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

describe('hold Ctrl with no page session', () => {
  const isle = () => h.evaluate<boolean>(`!!document.documentElement.querySelector('et-isle')`);
  /** Whether #intro still has the very translation node marked before growing. */
  const sameIntroTranslation = () =>
    h.evaluate<boolean>(`(() => {
      const copies = document.querySelectorAll('#intro > et-tr:not([data-et-state])');
      return copies.length === 1 && copies[0].getAttribute('data-e2e-mark') === '1';
    })()`);

  /** Holds over #intro with no session: that paragraph alone, no isle. */
  async function heldIntro() {
    await h.openPage('e2e-article.html');
    await hold('#intro', 1);
    await sleep(300);
    expect(await translationsIn('#linked')).toBe(0);
    expect(await h.evaluate<number>(`document.querySelectorAll('et-tr').length`)).toBe(1);
    expect(await isle()).toBe(false);
    expect(await state()).toMatchObject({ phase: 'done', translated: 1, scope: 'units' });
    await h.evaluate(`document.querySelector('#intro > et-tr').setAttribute('data-e2e-mark', '1')`);
  }

  async function grown() {
    await waitFor(
      async () => (await state()).translated >= 8 && (await translationsIn('#linked')),
      {
        message: 'the first screen to be translated',
      },
    );
    expect(await sameIntroTranslation()).toBe(true);
    expect((await state()).scope).toBeUndefined();
    await waitFor(isle, { message: 'the isle once the whole page is translated' });
    h.assertNoErrors();
  }

  it('translates the held paragraph alone, with no isle; the page shortcut then grows it', async () => {
    await heldIntro();
    await h.tell('page.toggle');
    await grown();
  });

  it('grows the same way from the panel\'s "translate this page" (page.start)', async () => {
    await heldIntro();
    expect(await h.tell<Ok<PageState>>('page.start', {})).toMatchObject({ ok: true });
    await grown();
  });
});

describe('the hold key setting', () => {
  async function setHoldKey(value: 'ctrl' | 'alt' | 'off') {
    const options = await h.extPage('options.html');
    expect(await options.send('config.patch', [{ path: 'page.holdKey', value }])).toMatchObject({
      ok: true,
    });
    await options.close();
    // The page hears of it through storage.onChanged: no sign of it to wait for.
    await sleep(300);
  }

  it('ignores Ctrl when off, then follows Alt once Alt is chosen', async () => {
    await h.openPage('e2e-article.html');
    try {
      await setHoldKey('off');
      await move(await pointOn('#intro'));
      await ctrl('rawKeyDown');
      await sleep(1200);
      await ctrl('keyUp');
      expect(await h.evaluate<number>(`document.querySelectorAll('et-tr').length`)).toBe(0);

      await setHoldKey('alt');
      await hold('#intro', 1, alt);
      expect(await translationsIn('#linked')).toBe(0);
      h.assertNoErrors();
    } finally {
      await setHoldKey('ctrl');
    }
  });
});
