// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverUnits } from './discover';
import type { StyleReader } from './dom-rules';
import { createRenderer } from './render';

const readStyle: StyleReader = (el) => {
  const own = (el as HTMLElement).style?.display;
  if (own) return { display: own };
  return { display: el.tagName === 'DIV' || el.tagName === 'BODY' ? 'block' : 'inline' };
};

async function setup(markup: string) {
  document.body.innerHTML = markup;
  const before = document.body.innerHTML;
  const units = await discoverUnits(document.body, { readStyle });
  const renderer = createRenderer({ win: window, style: 'faded', target: 'zh-CN', readStyle });
  return { units, renderer, before };
}

beforeEach(() => {
  document.head.innerHTML = '';
});

describe('renderer: insert and restore', () => {
  it('appends a block translation inside the paragraph and restores the page exactly', async () => {
    const { units, renderer, before } = await setup(
      '<p class="lead">The best tools disappear.</p>',
    );
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    expect(await renderer.insert([{ unit, translation: '最好的工具会消失。' }])).toEqual([]);
    expect(document.body.innerHTML).toBe(
      '<p class="lead">The best tools disappear.<et-tr data-et-s="faded" lang="zh-CN" translate="no" dir="auto">最好的工具会消失。</et-tr></p>',
    );
    await renderer.restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('rebuilds links and inline code from the source elements', async () => {
    const { units, renderer } = await setup(
      '<p>Read <a href="/guide">the guide</a> and run <code>npm i</code>.</p>',
    );
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    await renderer.insert([{ unit, translation: '运行 <t1/> 之前先读<t0>指南</t0>。' }]);
    expect(document.querySelector('et-tr')?.innerHTML).toBe(
      '运行 <code>npm i</code> 之前先读<a href="/guide">指南</a>。',
    );
  });

  it('falls back to plain text when the tags come back broken', async () => {
    const { units, renderer } = await setup('<p>Read <a href="/guide">the guide</a> today.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    await renderer.insert([{ unit, translation: '今天读指南。' }]);
    expect(document.querySelector('et-tr')?.innerHTML).toBe('今天读指南。');
  });

  it('puts a run translation inline right after the run', async () => {
    const { units, renderer, before } = await setup(
      '<div>Intro words here<p>A paragraph.</p></div>',
    );
    const run = units.find((unit) => unit.kind === 'run');
    if (!run) throw new Error('no run');
    await renderer.insert([{ unit: run, translation: '引言' }]);
    const inserted = document.querySelector('div')?.childNodes[1] as Element | undefined;
    expect(inserted?.nodeName).toBe('ET-TR');
    expect(inserted?.hasAttribute('data-et-inline')).toBe(true);
    await renderer.restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('puts a flex meta row translation inline inside its last text element', async () => {
    const { units, renderer } = await setup(
      '<div style="display:flex"><span>Mara Ellis</span><span>6 min read</span></div>',
    );
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    await renderer.insert([{ unit, translation: '阅读约 6 分钟' }]);
    const inserted = document.querySelectorAll('span')[1]?.lastChild as Element | undefined;
    expect(inserted?.nodeName).toBe('ET-TR');
    expect(inserted?.hasAttribute('data-et-inline')).toBe(true);
  });

  it('skips and reports a unit whose text changed before the result arrived', async () => {
    const { units, renderer } = await setup('<p>Original text here.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    (unit.root.firstChild as Text).nodeValue = 'Edited by the page.';
    expect(await renderer.insert([{ unit, translation: '旧译文' }])).toEqual([unit]);
    expect(document.querySelector('et-tr')).toBeNull();
  });
});

describe('renderer: translation only', () => {
  it('hides the original, pins spacing, and restores the style attribute exactly', async () => {
    const { units, renderer, before } = await setup(
      '<p style="color: red;">Pinned paragraph text.</p><p>Plain paragraph text.</p>',
    );
    await renderer.insert(units.map((unit) => ({ unit, translation: '译文' })));
    await renderer.setMode('translation');
    const [styled, plain] = [...document.querySelectorAll('p')];
    expect(styled?.hasAttribute('data-et-only')).toBe(true);
    expect(plain?.hasAttribute('data-et-only')).toBe(true);
    await renderer.setMode('bilingual');
    expect(styled?.getAttribute('style')).toBe('color: red;');
    expect(plain?.hasAttribute('style')).toBe(false);
    await renderer.setMode('translation');
    await renderer.restoreAll();
    expect(document.body.innerHTML).toBe(before);
  });

  it('keeps the original for runs and for link paragraphs that fell back to plain text', async () => {
    const { units, renderer } = await setup(
      '<p>See <a href="/x">this</a> now.</p><div>Run text here<p>Block text here.</p></div>',
    );
    const link = units.find((unit) => unit.seg.hasLink);
    const run = units.find((unit) => unit.kind === 'run');
    if (!link || !run) throw new Error('missing units');
    await renderer.insert([
      { unit: link, translation: '现在看这个。' },
      { unit: run, translation: '运行' },
    ]);
    await renderer.setMode('translation');
    expect(link.root.hasAttribute('data-et-only')).toBe(false);
    expect(run.root.hasAttribute('data-et-only')).toBe(false);
  });

  it('applies translation-only to units inserted while the mode is on', async () => {
    const { units, renderer } = await setup(
      '<p>First paragraph text.</p><p>Second paragraph text.</p>',
    );
    const [first, second] = units;
    if (!first || !second) throw new Error('no units');
    await renderer.insert([{ unit: first, translation: '一' }]);
    await renderer.setMode('translation');
    await renderer.insert([{ unit: second, translation: '二' }]);
    expect(second.root.hasAttribute('data-et-only')).toBe(true);
  });
});

describe('renderer: failures and lifecycle', () => {
  it('shows a quiet retry that calls back once per click', async () => {
    const { units, renderer } = await setup('<p>Every interruption costs attention.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    const retry = vi.fn();
    await renderer.fail(unit, retry, '网络超时');
    const tr = document.querySelector('et-tr');
    expect(tr?.getAttribute('data-et-state')).toBe('error');
    expect(tr?.textContent).toBe('未译出 ·重试');
    tr?.querySelector('button')?.click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(renderer.isFailed(unit)).toBe(true);
    await renderer.insert([{ unit, translation: '每一次打断都有代价。' }]);
    expect(renderer.isFailed(unit)).toBe(false);
    expect(document.querySelectorAll('et-tr')).toHaveLength(1);
  });

  it('notices translations a framework removed', async () => {
    const { units, renderer } = await setup('<p>Framework managed text.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    await renderer.insert([{ unit, translation: '框架管理的文字' }]);
    document.querySelector('et-tr')?.remove();
    expect(renderer.detached()).toEqual([unit]);
  });

  it('drops one unit at once', async () => {
    const { units, renderer, before } = await setup('<p>Some words to drop.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    await renderer.insert([{ unit, translation: '要删除的文字' }]);
    renderer.drop(unit);
    expect(document.body.innerHTML).toBe(before);
    expect(renderer.has(unit)).toBe(false);
  });
});
