// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  plainTranslation,
  restoreTranslation,
  sanitizedClone,
  segment,
  stripTags,
} from './segment';

function nodesOf(html: string): Node[] {
  const host = document.createElement('div');
  host.innerHTML = html;
  return [...host.childNodes];
}

function html(fragment: DocumentFragment): string {
  const box = document.createElement('div');
  box.append(fragment);
  return box.innerHTML;
}

describe('segment', () => {
  it('sends plain text when there is no inline markup', () => {
    const seg = segment(nodesOf('  The best   tools\n disappear. '));
    expect(seg).toMatchObject({ text: 'The best tools disappear.', prefix: '', marks: [] });
  });

  it('wraps inline elements in numbered tags and keeps code verbatim', () => {
    const seg = segment(
      nodesOf('Read <a href="/guide">the <b>full</b> guide</a>, then run <code>npm i</code>.'),
    );
    expect(seg.text).toBe('Read <t0>the <t1>full</t1> guide</t0>, then run <t2/>.');
    expect(seg.plain).toBe('Read the full guide, then run npm i.');
    expect(seg.marks.map((mark) => mark.kind)).toEqual(['pair', 'pair', 'void']);
    expect(seg.hasLink).toBe(true);
  });

  it('switches prefix when the source already contains the tag syntax, deterministically', () => {
    const source = 'Use <em>&lt;t0&gt;</em> tags';
    const first = segment(nodesOf(source));
    expect(first.prefix).toBe('u');
    expect(first.text).toBe('Use <u0><t0></u0> tags');
    expect(segment(nodesOf(source)).text).toBe(first.text);
  });

  it('drops hidden and skipped descendants', () => {
    const seg = segment(
      nodesOf('Hello <span aria-hidden="true">★</span><button>Follow</button>world <svg></svg>'),
    );
    expect(seg.plain).toBe('Hello world');
  });

  it('finds a single wrapping element', () => {
    expect(segment(nodesOf(' <a href="/x">A title</a> ')).soleWrapper?.tagName).toBe('A');
    expect(segment(nodesOf('Go <a href="/x">here</a>')).soleWrapper).toBeUndefined();
  });
});

describe('restoreTranslation', () => {
  const seg = () =>
    segment(
      nodesOf(
        'Read <a href="/guide" class="x" onclick="evil()" id="l">the guide</a> and run <code>npm i</code>.',
      ),
    );

  it('rebuilds tags as clones of the source elements, whatever the word order', () => {
    const fragment = restoreTranslation('运行 <t1/> 之前先读<t0>指南</t0>。', seg(), document);
    expect(fragment && html(fragment)).toBe(
      '运行 <code>npm i</code> 之前先读<a href="/guide" class="x">指南</a>。',
    );
  });

  it.each([
    ['missing tag', '先读指南，然后运行 <t1/>。'],
    ['duplicated tag', '<t0>指南</t0><t0>又一次</t0><t1/>'],
    ['crossed tags', '<t0>指南<t1/></t1></t0>'],
    ['unknown id', '<t0>指南</t0><t1/><t7>多出</t7>'],
    ['unclosed', '<t0>指南<t1/>'],
    ['void used as pair', '<t0>指南</t0><t1>x</t1>'],
  ])('rejects a %s', (_name, translation) => {
    expect(restoreTranslation(translation, seg(), document)).toBeUndefined();
  });

  it('never parses the translation as HTML', () => {
    const plain = segment(nodesOf('Hello world'));
    const fragment = restoreTranslation('<img src=x onerror=alert(1)>你好', plain, document);
    expect(fragment && html(fragment)).toBe('&lt;img src=x onerror=alert(1)&gt;你好');
  });
});

describe('fallbacks and sanitizing', () => {
  it('strips tags for the plain fallback and keeps a sole wrapper', () => {
    expect(stripTags('先读<t0>指南</t0>，运行 <t1/>。', 't')).toBe('先读指南，运行 。');
    const seg = segment(nodesOf('<a href="https://e.com/post">A title</a>'));
    expect(html(plainTranslation('<t0>标题</t0>', seg, document))).toBe(
      '<a href="https://e.com/post">标题</a>',
    );
  });

  it('removes javascript: links and event handlers, keeps relative links and styling', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<a href="javascript:alert(1)" onclick="x()">a</a><a href="/wiki/Foo" class="c" style="color:red">b</a>';
    const [bad, good] = [...host.children];
    expect(sanitizedClone(bad as Element, true).outerHTML).toBe('<a>a</a>');
    expect(sanitizedClone(good as Element, false).outerHTML).toBe(
      '<a href="/wiki/Foo" class="c" style="color:red"></a>',
    );
  });
});
