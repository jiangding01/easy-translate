// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createPacer, discoverUnits } from './discover';
import { isInlineElement, type StyleReader } from './dom-rules';

/**
 * Display from the inline style, else a tag default: deterministic across DOM
 * shims. Like browsers, it blockifies flex and grid items and out-of-flow
 * (absolute, fixed, floated) boxes.
 */
const readStyle: StyleReader = (el) => {
  const style = (el as HTMLElement).style;
  const own =
    style?.display || (el.tagName === 'DIV' || el.tagName === 'BODY' ? 'block' : 'inline');
  const position = style?.position || 'static';
  const float = style?.cssFloat || 'none';
  const parentDisplay = el.parentElement?.style?.display ?? '';
  const blockified =
    /^(inline-)?(flex|grid)$/.test(parentDisplay) ||
    position === 'absolute' ||
    position === 'fixed' ||
    float !== 'none';
  if (blockified && own.startsWith('inline')) {
    return { display: own.replace(/^inline-?/, '') || 'block', position, float };
  }
  return { display: own, position, float };
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

  it('translates flex items one by one: their gaps are CSS, not text', async () => {
    const found = await units(
      '<div style="display:flex"><span>Mara Ellis</span><span>·</span><span>6 min read</span></div>',
    );
    expect(found).toEqual([
      { kind: 'block', root: 'SPAN', text: 'Mara Ellis' },
      { kind: 'block', root: 'SPAN', text: '6 min read' },
    ]);
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

describe('code toolbars and role=img', () => {
  it('skips the label bar of a claude.dev code block', async () => {
    expect(
      await units(
        '<div class="art-code"><div class="ch"><span>CODE<span class="lang">Python</span></span><button>Copy</button></div><pre>x = 1</pre></div><p>After the code.</p>',
      ),
    ).toEqual([{ kind: 'block', root: 'P', text: 'After the code.' }]);
  });

  it('skips the language tag of a VitePress code block', async () => {
    expect(
      await units(
        '<div class="language-sh"><button class="copy"></button><span class="lang">sh</span><pre>ls</pre></div><p>Then run it.</p>',
      ),
    ).toEqual([{ kind: 'block', root: 'P', text: 'Then run it.' }]);
  });

  it('skips text inside a role=img block but not the caption beside it', async () => {
    expect(
      await units(
        '<figure><div role="img" aria-label="diagram"><div>Settings panel</div><div>Effort level</div></div><figcaption>A diagram of settings.</figcaption></figure>',
      ),
    ).toEqual([{ kind: 'block', root: 'FIGCAPTION', text: 'A diagram of settings.' }]);
  });
});

describe('layout boundaries (claude.dev blog structures)', () => {
  it('splits a list of grid rows made of links and spans into one unit per cell', async () => {
    const row = (date: string, title: string) =>
      `<a class="frow" href="/x" style="display:grid"><span style="display:block">${date}</span><span style="display:block">${title}</span><span style="display:block">12 min</span></a>`;
    expect(
      await units(
        `<div>${row('Nov 09, 2026', 'Safely scaling multi-agent teams')}${row('Oct 15, 2026', 'How the team does code review')}</div>`,
      ),
    ).toEqual([
      { kind: 'block', root: 'SPAN', text: 'Safely scaling multi-agent teams' },
      { kind: 'block', root: 'SPAN', text: 'How the team does code review' },
    ]);
  });

  it('keeps a flex column footer brand apart from each legal link', async () => {
    const found = await units(
      '<div class="fb-brand" style="display:flex;flex-direction:column"><span style="display:block">claude.dev</span><span style="display:block"><span>© 2026 Anthropic PBC</span><span style="display:flex"><a href="/p">Privacy Policy</a><a href="/t">Terms of Use</a></span></span></div>',
    );
    // "claude.dev" is filtered as an identifier; brand and legal links never merge.
    expect(found.map((unit) => unit.text).sort()).toEqual([
      'Privacy Policy',
      'Terms of Use',
      '© 2026 Anthropic PBC',
    ]);
  });

  it('treats wrapped flex rows of cards as separate units', async () => {
    expect(
      (
        await units(
          '<div style="display:flex;flex-wrap:wrap"><div>First product card text</div><div>Second product card text</div></div>',
        )
      ).map((unit) => unit.text),
    ).toEqual(['First product card text', 'Second product card text']);
  });

  it('keeps a span that really is inline inside its paragraph', async () => {
    expect(await units('<p>Plain <span>inline words</span> stay together.</p>')).toEqual([
      { kind: 'block', root: 'P', text: 'Plain inline words stay together.' },
    ]);
  });
});

describe('layout boundaries inside a sentence', () => {
  it('keeps screen-reader-only and floated spans inside their sentence', async () => {
    expect(
      await units(
        '<p>Check out <a href="/x">the guide<span style="position:absolute">about pricing</span></a> and <span style="float:right">this badge</span> today.</p>',
      ),
    ).toHaveLength(1);
  });

  it('keeps an inline-flex chip and its inner spans inside the sentence', async () => {
    expect(
      await units(
        '<p>Press <span style="display:inline-flex">the <span>Ctrl key</span></span> to continue.</p>',
      ),
    ).toEqual([{ kind: 'block', root: 'P', text: 'Press the Ctrl key to continue.' }]);
  });

  it('treats ruby as inline and leaves the reading out of the text', async () => {
    expect(
      await units(
        '<p>日本語の<ruby style="display:ruby">漢字<rt style="display:ruby-text">かんじ</rt></ruby>を読む</p>',
      ),
    ).toEqual([{ kind: 'block', root: 'P', text: '日本語の漢字を読む' }]);
  });
});

describe('isInlineElement with display none', () => {
  it('falls back to the tag instead of treating a hidden element as a block', () => {
    const none = () => ({ display: 'none' });
    expect(isInlineElement(document.createElement('relative-time'), none)).toBe(true);
    expect(isInlineElement(document.createElement('div'), none)).toBe(false);
  });
});

describe('content added while a container is still being scanned', () => {
  /** A reader that runs `hook` once, on the first element of `tag` it is asked about. */
  function hooked(tag: string, hook: () => void): StyleReader {
    let done = false;
    return (el) => {
      if (!done && el.tagName === tag) {
        done = true;
        hook();
      }
      return readStyle(el);
    };
  }
  const NEW_BLOCKS = '<div id="n"><div>New heading text.</div><div>New body text.</div></div>';

  async function scan(markup: string, tag: string, hook: () => void) {
    document.body.innerHTML = markup;
    const found = await discoverUnits(document.body, { readStyle: hooked(tag, hook) });
    return found.map((unit) => ({
      kind: unit.kind,
      root: unit.root.id || unit.root.tagName,
      text: unit.seg.plain,
    }));
  }

  it('does not fold blocks added to a block parent into one of its runs', async () => {
    const found = await scan(
      '<div id="feed"><div><span>Old one</span> text here.</div><div>Old two text here.</div></div>',
      'SPAN',
      () => document.getElementById('feed')?.insertAdjacentHTML('beforeend', NEW_BLOCKS),
    );
    expect(found.map((unit) => unit.text)).toEqual(['Old one text here.', 'Old two text here.']);
  });

  it('does not wrap blocks added to a parent that had only inline content', async () => {
    const found = await scan('<div id="feed"><span>Old text</span> here.</div>', 'SPAN', () =>
      document.getElementById('feed')?.insertAdjacentHTML('beforeend', NEW_BLOCKS),
    );
    expect(found).toEqual([{ kind: 'run', root: 'feed', text: 'Old text here.' }]);
  });

  it('leaves an inline parent alone when something is added to it', async () => {
    const found = await scan(
      '<p id="p">Read <a id="a" href="/x"><b>the</b> guide</a> now.</p>',
      'B',
      () => document.getElementById('a')?.insertAdjacentHTML('beforeend', '<svg></svg>'),
    );
    expect(found).toEqual([{ kind: 'block', root: 'p', text: 'Read the guide now.' }]);
  });
});

describe('oversized paragraphs', () => {
  async function found(markup: string) {
    document.body.innerHTML = markup;
    return discoverUnits(document.body, { readStyle });
  }

  it('marks a block over the limit as a skipped unit', async () => {
    const [unit, ...rest] = await found(`<p>${'word '.repeat(1100)}</p>`);
    expect(rest).toEqual([]);
    expect(unit?.kind).toBe('block');
    expect(unit?.skipped).toBe('long');
  });

  it('leaves the flag off ordinary units', async () => {
    const [unit] = await found('<p>Ordinary paragraph text.</p>');
    expect(unit).toBeDefined();
    expect('skipped' in (unit ?? {})).toBe(false);
  });

  it('puts the limit at 5000 sent characters', async () => {
    const exactly = 'a'.repeat(4999);
    const [fits] = await found(`<p>${exactly} </p>`);
    expect(fits?.seg.text.length).toBe(4999);
    const text5000 = `${'a'.repeat(4995)} bcde`;
    const [edge] = await found(`<p>${text5000}</p>`);
    expect(edge?.seg.text.length).toBe(5000);
    expect(edge?.skipped).toBeUndefined();
    const [over] = await found(`<p>${text5000}f</p>`);
    expect(over?.seg.text.length).toBe(5001);
    expect(over?.skipped).toBe('long');
  });

  it('finds nothing in a huge URL or a numeric table', async () => {
    expect(await found(`<p>https://example.com/${'a'.repeat(6000)}</p>`)).toEqual([]);
    expect(await found(`<p>${'1 '.repeat(3000)}</p>`)).toEqual([]);
  });

  it('gives each oversized run in one block its own skipped unit', async () => {
    const long = 'word '.repeat(1100);
    const list = await found(`<div>${long}<p>Between the runs.</p>${long}</div>`);
    const runs = list.filter((unit) => unit.kind === 'run');
    expect(runs).toHaveLength(2);
    expect(runs.map((unit) => unit.skipped)).toEqual(['long', 'long']);
    expect(runs[0]?.root).toBe(runs[1]?.root);
  });

  it('judges length by the sent text: a huge inline code does not make a paragraph long', async () => {
    const [unit, ...rest] = await found(
      `<p>Run <code>${'x'.repeat(6000)}</code> before you start.</p>`,
    );
    expect(rest).toEqual([]);
    expect(unit?.skipped).toBeUndefined();
    expect(unit?.seg.text.length).toBeLessThan(100);
  });

  it('skips blocks without prose once code and icons are left out', async () => {
    expect(await units('<p><code>npm install</code></p>')).toEqual([]);
    expect(await units('<p><span role="img" aria-label="rocket">Rocket</span> 3</p>')).toEqual([]);
    expect(await units('<p><code>x</code> <code>y</code></p>')).toEqual([]);
  });

  it('sends the text without leading separators', async () => {
    expect(await units('<p>•› Model</p>')).toEqual([{ kind: 'block', root: 'P', text: 'Model' }]);
  });
});
