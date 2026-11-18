import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

// P0-3: display modes, and a full restore that leaves the page as it was.

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
  await prepare(h, { clearCache: true });
});

afterAll(() => h?.close());

const state = async () => (await h.tell<Ok<PageState>>('page.getState')).data;
const setMode = (mode: string) => h.tell<Ok<PageState>>('page.setMode', mode);

/** What a restore must give back: the container's markup and the root element's attributes. */
const snapshot = () =>
  h.evaluate<{ article: string; root: string }>(`({
    article: document.querySelector('#article').innerHTML,
    root: JSON.stringify([...document.documentElement.attributes].map((a) => [a.name, a.value])),
  })`);

/** Names of every et-* element and data-et-* attribute in the document. */
const leftovers = () =>
  h.evaluate<string[]>(`[...document.querySelectorAll('*')].flatMap((el) => [
    ...(el.localName.startsWith('et-') ? [el.localName] : []),
    ...el.getAttributeNames().filter((n) => n.startsWith('data-et-')).map((n) => el.localName + '@' + n),
  ])`);

/** Translates the open page's first screen. */
async function translateFirstScreen() {
  await h.tell('page.toggle');
  await waitFor(async () => (await state()).translated >= 8, {
    message: 'the first screen to be translated',
  });
}

/** Switches to translation-only and waits until #intro shows its translation. */
async function toTranslationOnly() {
  expect(await setMode('translation')).toMatchObject({ data: { mode: 'translation' } });
  await waitFor(
    () =>
      h.evaluate(`(() => {
        const root = document.querySelector('#intro');
        return root.hasAttribute('data-et-only') &&
          root.querySelector('et-tr')?.textContent.includes('【MOCK】');
      })()`),
    { message: 'translation only, with the translation shown' },
  );
}

async function restore() {
  await h.tell('page.toggle');
  await waitFor(
    async () =>
      (await state()).phase === 'idle' &&
      (await h.evaluate<boolean>(`!document.querySelector('et-tr, et-isle, et-selection')`)),
    { message: 'the page to be restored' },
  );
}

describe('display modes', () => {
  it('switches to translation-only and back, then shows the original again', async () => {
    await h.openPage('e2e-article.html');
    const before = await snapshot();
    await h.tell('page.toggle');
    await waitFor(async () => (await state()).translated >= 8, {
      message: 'the first screen to be translated',
    });

    // Translation only: the original text is zeroed out, the translation keeps its size.
    expect(await setMode('translation')).toMatchObject({ ok: true, data: { mode: 'translation' } });
    await waitFor(
      () => h.evaluate(`document.querySelector('#intro').hasAttribute('data-et-only')`),
      { message: 'the original to be hidden' },
    );
    expect(
      await h.evaluate(`(() => {
        const root = document.querySelector('#intro');
        const tr = root.querySelector('et-tr');
        return {
          root: getComputedStyle(root).fontSize,
          tr: getComputedStyle(tr).fontSize,
          text: tr.textContent,
        };
      })()`),
    ).toMatchObject({ root: '0px', tr: '15px', text: expect.stringContaining('【MOCK】') });

    // Back to bilingual: the original is shown again next to its translation.
    expect(await setMode('bilingual')).toMatchObject({ ok: true, data: { mode: 'bilingual' } });
    await waitFor(() => h.evaluate(`!document.querySelector('[data-et-only]')`), {
      message: 'the original to be shown again',
    });
    expect(await h.evaluate(`getComputedStyle(document.querySelector('#intro')).fontSize`)).toBe(
      '15px',
    );
    expect(await h.evaluate(`document.querySelectorAll('et-tr').length`)).toBeGreaterThan(0);

    // Show the original: nothing of ours is left in the document.
    await restore();
    expect(await leftovers()).toEqual([]);
    const after = await snapshot();
    expect(after.article).toBe(before.article);
    expect(after.root).toBe(before.root);
    h.assertNoErrors();
  });

  it('restores the container markup exactly after plain bilingual translation', async () => {
    await h.openPage('e2e-article.html');
    const before = await snapshot();
    await translateFirstScreen();
    expect(await h.evaluate(`document.querySelectorAll('et-tr').length`)).toBeGreaterThan(0);
    await restore();
    expect(await leftovers()).toEqual([]);
    expect(await snapshot()).toEqual(before);
    h.assertNoErrors();
  });

  it('leaves no empty style attribute after translation-only', async () => {
    await h.openPage('e2e-article.html');
    const before = await snapshot();
    await translateFirstScreen();
    await toTranslationOnly();
    await restore();
    expect(await leftovers()).toEqual([]);
    expect(await snapshot()).toEqual(before);
    h.assertNoErrors();
  });

  it('keeps what the page changed in a block while translation-only was on', async () => {
    await h.openPage('e2e-article.html');
    await translateFirstScreen();
    await toTranslationOnly();
    // #title is pinned too (text-indent), so removing it leaves nothing of ours behind.
    expect(await h.evaluate<string>(`document.querySelector('#title').style.textIndent`)).not.toBe(
      '',
    );
    await h.evaluate(`(() => {
      document.querySelector('#intro').style.setProperty('color', 'blue');
      document.querySelector('#title').style.removeProperty('text-indent');
    })()`);
    await restore();
    const styles = await h.evaluate<{ intro: string | null; title: boolean }>(`({
      intro: document.querySelector('#intro').getAttribute('style'),
      title: document.querySelector('#title').hasAttribute('style'),
    })`);
    expect(styles.intro?.replace(/\s+/g, ' ').trim()).toBe('color: blue;');
    expect(styles.title).toBe(false);
    expect(await leftovers()).toEqual([]);
    h.assertNoErrors();
  });

  it('keeps a var() shorthand margin working after translation-only', async () => {
    await h.openPage('e2e-article.html');
    await translateFirstScreen();
    await toTranslationOnly();
    // The block must really be switched, or the case would pass without a restore.
    await waitFor(
      () => h.evaluate(`document.querySelector('#pinned').hasAttribute('data-et-only')`),
      {
        message: '#pinned to be translation-only',
      },
    );
    await h.evaluate(`document.querySelector('#pinned').style.setProperty('color', 'blue')`);
    await restore();
    const after = await h.evaluate<{ style: string; margin: string; color: string }>(`(() => {
      const el = document.querySelector('#pinned');
      const cs = getComputedStyle(el);
      return { style: el.getAttribute('style'), margin: cs.marginLeft, color: el.style.color };
    })()`);
    expect(after.margin).toBe('10px');
    expect(after.style).toContain('var(--x)');
    expect(after.style).toContain('--x');
    expect(after.color).toBe('blue');
    expect(await leftovers()).toEqual([]);
    h.assertNoErrors();
  });
});
