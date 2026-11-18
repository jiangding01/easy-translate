import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, waitFor } from './harness';
import { prepare } from './support';

// P0-6: selection translation. The dot and card live in a closed shadow root, so reads go
// through h.shadow and the dot is clicked at its hit zone's centre with a trusted click.

let h: Harness;
trackTests(() => h);

beforeAll(async () => {
  h = await launch({ ui: 'en' });
  await prepare(h, { clearCache: true });
});

afterAll(() => h?.close());

const HOST = 'et-selection';

/** Selects `phrase` inside the first element matching `selector`, as a script would. */
function select(selector: string, phrase: string) {
  return h.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(${JSON.stringify(phrase)});
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + ${phrase.length});
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return true;
    }
    throw new Error('no text ' + ${JSON.stringify(phrase)});
  })()`);
}

/** The shadow root's `.r` view: gone, dot or card; 'none' before the host exists. */
async function view(): Promise<string> {
  const present = await h.evaluate<boolean>(`!!document.querySelector('${HOST}')`);
  if (!present) return 'none';
  return h.shadow<string>(HOST, `(root) => root.querySelector('.r')?.dataset.view ?? 'none'`);
}

async function showDot(selector: string, phrase: string) {
  await select(selector, phrase);
  await waitFor(async () => (await view()) === 'dot', { message: 'the selection dot' });
}

/** The dot's centre: its hit zone is a circle around it. */
async function dotCentre() {
  return h.shadow<{ x: number; y: number }>(
    HOST,
    `(root) => {
      const r = root.querySelector('.zn').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }`,
  );
}

async function openCard(selector: string, phrase: string) {
  await showDot(selector, phrase);
  await h.trustedClick(await dotCentre());
  await waitFor(async () => (await view()) === 'card', { message: 'the card to open' });
}

const cardText = (part: string) =>
  h.shadow<string>(HOST, `(root) => root.querySelector('${part}')?.textContent ?? ''`);

describe('selection', () => {
  it('shows a dot for a foreign sentence and a translation card after a click', async () => {
    await h.openPage('e2e-article.html');
    const phrase = 'the fishing boats leave before sunrise';
    await openCard('#intro', phrase);
    await waitFor(async () => (await cardText('.bi')).includes('【MOCK】'), {
      message: 'the card to show the mock translation',
    });
    expect(await cardText('.bi')).toContain(phrase.toUpperCase());
    expect(h.google.texts).toContain(phrase);
    h.assertNoErrors();
  });

  it('shows UK and US phonetics for a single English word', async () => {
    await h.openPage('e2e-article.html');
    await openCard('#word', 'serendipity');
    await waitFor(async () => /UK.*US/s.test(await cardText('.ph')), {
      message: 'the phonetic line',
    });
    expect(await cardText('.st')).toBe('serendipity');
    h.assertNoErrors();
  });

  it('shows no dot for target-language text or a text field', async () => {
    await h.openPage('e2e-article.html');
    // A dot that can disappear proves the checks ran: first a selection that gets one.
    await showDot('#intro', 'the fishing boats');
    await select('#chinese', '港口的清晨很安静，渔船在日出之前就已经出海了。');
    await waitFor(async () => (await view()) !== 'dot', {
      message: 'the dot to go away for target-language text',
    });

    // Text inside a text field: the selection must be real, so the editable check is what ran.
    await showDot('#intro', 'the harbour stays silent');
    const inField = await h.evaluate<boolean>(
      `(() => { const f = document.querySelector('#field'); f.focus(); f.setSelectionRange(0, f.value.length); return f.selectionStart !== f.selectionEnd; })()`,
    );
    expect(inField).toBe(true);
    await waitFor(async () => (await view()) !== 'dot', {
      message: 'the dot to go away for a text field',
    });

    // Same for a contenteditable block, whose page selection is non-empty.
    await h.evaluate(`document.activeElement?.blur()`);
    await showDot('#intro', 'the first bakery opens');
    await select('#editable', 'draft note about the quiet harbour');
    expect(await h.evaluate<string>(`getSelection().toString()`)).not.toBe('');
    await waitFor(async () => (await view()) !== 'dot', {
      message: 'the dot to go away for an editable block',
    });
    h.assertNoErrors();
  });
});
