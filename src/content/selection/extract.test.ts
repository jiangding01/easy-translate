// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { composedRange, extractText } from './extract';
import { normalizeSelectionText } from './open';

/** Selects `node`'s contents (or a text node's [start, end)) as the page selection would. */
function select(node: Node, start?: number, end?: number) {
  const range = document.createRange();
  if (start !== undefined) {
    range.setStart(node, start);
    range.setEnd(node, end ?? (node as Text).data.length);
  } else range.selectNodeContents(node);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return { range, rendered: normalizeSelectionText(selection?.toString() ?? '') };
}

const extract = (node: Node, start?: number, end?: number) => {
  const { range, rendered } = select(node, start, end);
  return extractText(range, window, rendered);
};

const SR_ONLY =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('extractText (plan 4.3 rule 1)', () => {
  it('is the rendered text, normalized, when nothing is hidden', () => {
    document.body.innerHTML = '<p id="p">  A paper   map\n never tells you   where to go. </p>';
    const p = document.getElementById('p') as HTMLElement;
    expect(extract(p)).toBe('A paper map never tells you where to go.');
  });

  it('keeps exactly the selected part of a text node (one word, half a sentence)', () => {
    document.body.innerHTML = '<p id="p">A paper map never tells you where to go.</p>';
    const text = (document.getElementById('p') as HTMLElement).firstChild as Text;
    expect(extract(text, 8, 11)).toBe('map');
    expect(extract(text, 0, 20)).toBe('A paper map never te');
  });

  it('skips the original text translation-only mode hides with font-size 0', () => {
    document.body.innerHTML =
      '<p id="p" data-et-only="">The original sentence.<et-tr data-et-s="">原来的句子。</et-tr></p>';
    const p = document.getElementById('p') as HTMLElement;
    // toString would include the hidden original.
    expect(select(p).rendered).toContain('The original');
    expect(extract(p)).toBe('原来的句子。');
  });

  it('skips ruby readings (rt, rp)', () => {
    document.body.innerHTML =
      '<p id="p">東京<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>字です</p>';
    expect(extract(document.getElementById('p') as HTMLElement)).toBe('東京漢字です');
  });

  it('skips screen-reader-only text', () => {
    document.body.innerHTML = `<p id="p">Read <span style="${SR_ONLY}">(opens in a new tab)</span>more</p>`;
    expect(extract(document.getElementById('p') as HTMLElement)).toBe('Read more');
  });

  it('turns <br> and block boundaries into spaces once walking', () => {
    document.body.innerHTML = `<div id="d"><p>first<br>line<rt>x</rt></p><p>second</p></div>`;
    expect(extract(document.getElementById('d') as HTMLElement)).toBe('first line second');
  });

  it('cuts partial text nodes at the range boundaries while walking', () => {
    document.body.innerHTML = '<p id="p">alpha <ruby>漢<rt>kan</rt></ruby> omega</p>';
    const p = document.getElementById('p') as HTMLElement;
    const range = document.createRange();
    range.setStart(p.firstChild as Text, 2);
    range.setEnd(p.lastChild as Text, 3);
    expect(extractText(range, window, 'ignored')).toBe('pha 漢 om');
  });

  it('never takes more than toString: CSS-hidden tips are left out of the walk', () => {
    document.body.innerHTML = `<p id="p">Hover <span style="visibility:hidden">SECRET</span>me <span style="visibility:collapse">SECRET</span><span style="${SR_ONLY}">(new tab)</span>now</p>`;
    const text = extract(document.getElementById('p') as HTMLElement);
    expect(text).not.toContain('SECRET');
    expect(text).toBe('Hover me now');
  });

  it('never takes more than toString: form controls and non-rendered elements are left out', () => {
    document.body.innerHTML = `<p id="p">Pick <select><option>SECRET</option></select>or <textarea>SECRET</textarea>type <script>SECRET</script><style>p{}</style><noscript>SECRET</noscript><span style="${SR_ONLY}">x</span>here</p>`;
    const text = extract(document.getElementById('p') as HTMLElement);
    expect(text).not.toContain('SECRET');
    expect(text).toBe('Pick or type here');
  });

  it('is empty inside hidden text', () => {
    document.body.innerHTML = `<p><span id="s" style="${SR_ONLY}">hidden words</span></p>`;
    const span = document.getElementById('s') as HTMLElement;
    expect(extract(span.firstChild as Text, 0, 6)).toBe('');
  });
});

describe('composedRange (shadow DOM fallback)', () => {
  function shadowHost() {
    document.body.innerHTML = '<p id="p">before <span id="h"></span> after</p>';
    const host = document.getElementById('h') as HTMLElement;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<b>inside the shadow</b>';
    const p = document.getElementById('p') as HTMLElement;
    // What getRangeAt returns for a selection inside the shadow root: the host.
    const range = document.createRange();
    range.setStart(p, 1);
    range.setEnd(p, 2);
    return { root, range };
  }

  it('is undefined for a range not around a shadow host', () => {
    document.body.innerHTML = '<p id="p">plain</p>';
    const { range } = select(document.getElementById('p') as HTMLElement);
    expect(composedRange(document.getSelection() as Selection, range)).toBeUndefined();
  });

  it('uses getComposedRanges when the browser has it', () => {
    const { root, range } = shadowHost();
    const text = (root.firstChild as HTMLElement).firstChild as Text;
    const selection = {
      getComposedRanges: ({ shadowRoots }: { shadowRoots: ShadowRoot[] }) => {
        expect(shadowRoots).toEqual([root]);
        const inner = document.createRange();
        inner.setStart(text, 0);
        inner.setEnd(text, 6);
        return [inner];
      },
    } as unknown as Selection;
    const composed = composedRange(selection, range);
    expect(composed?.toString()).toBe('inside');
  });

  it('is null without getComposedRanges: the caller keeps toString and the pointer', () => {
    const { range } = shadowHost();
    expect(composedRange({} as Selection, range)).toBeNull();
  });
});
