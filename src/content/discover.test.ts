// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createPacer, discoverUnits } from './discover';
import type { StyleReader } from './dom-rules';

/** Display from the inline style, else a tag default: deterministic across DOM shims. */
const readStyle: StyleReader = (el) => {
  const own = (el as HTMLElement).style?.display;
  if (own) return { display: own };
  return { display: el.tagName === 'DIV' || el.tagName === 'BODY' ? 'block' : 'inline' };
};

async function units(markup: string) {
  document.body.innerHTML = markup;
  const found = await discoverUnits(document.body, { readStyle });
  return found.map((unit) => ({ kind: unit.kind, root: unit.root.tagName, text: unit.seg.plain }));
}

describe('discoverUnits', () => {
  it('finds leaf blocks, including headings and list items', async () => {
    expect(
      await units(
        '<article><h1>The quiet tools</h1><p>Good tools disappear.</p><ul><li>Respect rhythm.</li></ul></article>',
      ),
    ).toEqual([
      { kind: 'block', root: 'H1', text: 'The quiet tools' },
      { kind: 'block', root: 'P', text: 'Good tools disappear.' },
      { kind: 'block', root: 'LI', text: 'Respect rhythm.' },
    ]);
  });

  it('keeps inline markup inside one unit', async () => {
    expect(await units('<p>Read <a href="/g">the <b>full</b> guide</a> today.</p>')).toEqual([
      { kind: 'block', root: 'P', text: 'Read the full guide today.' },
    ]);
  });

  it('splits a mixed block into inline runs around its block children', async () => {
    expect(
      await units('<div>Intro text here <p>A paragraph inside.</p> trailing words too</div>'),
    ).toEqual([
      { kind: 'block', root: 'P', text: 'A paragraph inside.' },
      { kind: 'run', root: 'DIV', text: 'Intro text here' },
      { kind: 'run', root: 'DIV', text: 'trailing words too' },
    ]);
  });

  it('treats a flex meta row as one unit instead of blockified pieces', async () => {
    const found = await units(
      '<div style="display:flex"><span>Mara Ellis</span><span>·</span><span>6 min read</span></div>',
    );
    expect(found).toEqual([{ kind: 'block', root: 'DIV', text: 'Mara Ellis·6 min read' }]);
  });

  it('uses a flex child’s own display when it sets one', async () => {
    const found = await units(
      '<div style="display:flex"><div style="display:block">First column text</div><div style="display:block">Second column text</div></div>',
    );
    expect(found.map((unit) => unit.text)).toEqual(['First column text', 'Second column text']);
  });

  it('skips code, navigation, controls, hidden, editable and opted-out content', async () => {
    const found = await units(`
      <nav><p>Menu entry text</p></nav>
      <div role="toolbar"><p>Toolbar words</p></div>
      <pre>const answer = 42;</pre>
      <p translate="no">Brand name stays</p>
      <p class="notranslate">Also stays put</p>
      <div contenteditable="true"><p>Draft being typed</p></div>
      <p hidden>Hidden by attribute</p>
      <div aria-hidden="true"><p>Decorative words</p></div>
      <p>Visible prose here.</p>`);
    expect(found.map((unit) => unit.text)).toEqual(['Visible prose here.']);
  });

  it('keeps CSS-hidden content so it translates once shown', async () => {
    const found = await units('<div style="display:none"><p>Tab panel content</p></div>');
    expect(found.map((unit) => unit.text)).toEqual(['Tab panel content']);
  });

  it('ignores our own nodes and other translators’ nodes', async () => {
    const found = await units(
      '<p>Original words<et-tr>译文</et-tr></p><p><span class="immersive-translate-target-wrapper">别家</span>Other prose</p>',
    );
    expect(found.map((unit) => unit.text)).toEqual(['Original words', 'Other prose']);
  });

  it('filters identifiers and very short text', async () => {
    const found = await units(
      '<p>https://example.com/a</p><p>@mara</p><p>12 MB</p><p>a</p><p>index.ts</p><p>Real sentence.</p>',
    );
    expect(found.map((unit) => unit.text)).toEqual(['Real sentence.']);
  });

  it('survives very deep trees and yields while scanning', async () => {
    let markup = '';
    for (let depth = 0; depth < 600; depth += 1) markup += '<div>';
    markup += '<p>Too deep to matter</p>';
    for (let depth = 0; depth < 600; depth += 1) markup += '</div>';
    document.body.innerHTML = `${markup}<p>Shallow text</p>`;
    let yields = 0;
    let clock = 0;
    const pace = createPacer(
      8,
      () => (clock += 5),
      async () => {
        yields += 1;
      },
    );
    const found = await discoverUnits(document.body, { readStyle, pace });
    expect(found.map((unit) => unit.seg.plain)).toEqual(['Shallow text']);
    expect(yields).toBeGreaterThan(0);
  });

  it('stops when cancelled', async () => {
    document.body.innerHTML = '<p>One sentence.</p><p>Two sentences.</p>';
    const found = await discoverUnits(document.body, { readStyle, cancelled: () => true });
    expect(found).toEqual([]);
  });
});
