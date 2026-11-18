// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createGetMessage, loadLocales } from '../../scripts/i18n-messages.mjs';
import { discoverUnits } from './discover';
import { ISLE_TAG, OWN_ATTR, OWN_TAG, SELECTION_TAG, type StyleReader } from './dom-rules';
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

  it('pins font-relative sizes so a ch/em measure survives font-size:0', async () => {
    // claude.com: `.text-rich-text p { max-width: 80ch }` collapsed to 0 and the
    // translation stacked one character per line.
    const { units, renderer } = await setup('<p>Always-on agents run indefinitely.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    const root = unit.root as HTMLElement;
    await renderer.insert([{ unit, translation: '永远在线的代理无限期地运行。' }]);
    // happy-dom resolves neither ch/em nor the Typed OM: give the root a browser's answers.
    const computed: Record<string, string> = {
      'max-width': '1095px',
      'min-height': '60px',
      'text-indent': '40px',
      'flex-basis': 'auto',
      'min-width': 'auto',
      'max-height': 'none',
    };
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
      el === root
        ? ({
            fontSize: '22px',
            lineHeight: '33px',
            getPropertyValue: (name: string) => computed[name] ?? '0px',
          } as unknown as CSSStyleDeclaration)
        : real(el, pseudo),
    );
    Object.defineProperty(root, 'computedStyleMap', {
      configurable: true,
      value: () => ({ get: (name: string) => (name === 'width' ? '400px' : 'auto') }),
    });
    try {
      await renderer.setMode('translation');
      expect(root.style.getPropertyValue('max-width')).toBe('1095px');
      expect(root.style.getPropertyValue('min-height')).toBe('60px');
      expect(root.style.getPropertyValue('text-indent')).toBe('40px');
      expect(root.style.getPropertyValue('width')).toBe('400px');
      // Keywords stay with the host; `height: auto` must not freeze to used pixels.
      for (const name of ['height', 'flex-basis', 'min-width', 'max-height']) {
        expect(root.style.getPropertyValue(name)).toBe('');
      }
      await renderer.setMode('bilingual');
      expect(root.hasAttribute('style')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  describe('page edits while translation-only is on', () => {
    // happy-dom resolves neither ch/em nor the Typed OM: answer like a browser so that
    // max-width, text-indent, margin-left and width are pinned.
    const PINS = ['max-width', 'text-indent', 'margin-left', 'width'];
    async function pinned(markup: string, translate = '译文') {
      const { units, renderer } = await setup(markup);
      const [unit] = units;
      if (!unit) throw new Error('no unit');
      const root = unit.root as HTMLElement;
      await renderer.insert([{ unit, translation: translate }]);
      const computed: Record<string, string> = {
        'max-width': '600px',
        'text-indent': '20px',
      };
      const typed: Record<string, string> = { 'margin-left': '12px', width: '400px' };
      const real = window.getComputedStyle.bind(window);
      const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
        el === root
          ? ({
              fontSize: '16px',
              lineHeight: '24px',
              getPropertyValue: (name: string) => computed[name] ?? 'auto',
            } as unknown as CSSStyleDeclaration)
          : real(el, pseudo),
      );
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: (name: string) => typed[name] ?? 'auto' }),
      });
      await renderer.setMode('translation');
      for (const name of PINS) expect(root.style.getPropertyValue(name)).not.toBe('');
      return { root, renderer, spy };
    }
    const unpinned = (root: HTMLElement, except: string[] = []) => {
      for (const name of PINS) {
        if (!except.includes(name)) expect(root.style.getPropertyValue(name)).toBe('');
      }
    };

    it('keeps a color the page changed, on both ways out', async () => {
      const { root, renderer, spy } = await pinned('<p style="color: red;">Paragraph text.</p>');
      try {
        root.style.setProperty('color', 'blue');
        await renderer.setMode('bilingual');
        expect(root.style.getPropertyValue('color')).toBe('blue');
        expect(root.hasAttribute('data-et-only')).toBe(false);
        unpinned(root);

        await renderer.setMode('translation');
        root.style.setProperty('color', 'green');
        await renderer.restoreAll();
        expect(root.style.getPropertyValue('color')).toBe('green');
        unpinned(root);
      } finally {
        spy.mockRestore();
      }
    });

    it('leaves only the added color when the root had no style', async () => {
      const { root, renderer, spy } = await pinned('<p>Paragraph text.</p>');
      try {
        root.style.setProperty('color', 'blue');
        await renderer.setMode('bilingual');
        expect(root.style.length).toBe(1);
        expect(root.style.getPropertyValue('color')).toBe('blue');
        unpinned(root);
      } finally {
        spy.mockRestore();
      }
    });

    it('keeps the value the page gave a pinned property', async () => {
      const { root, renderer, spy } = await pinned('<p style="color: red;">Paragraph text.</p>');
      try {
        root.style.setProperty('margin-left', '30px');
        await renderer.setMode('bilingual');
        expect(root.style.getPropertyValue('margin-left')).toBe('30px');
        expect(root.style.getPropertyValue('color')).toBe('red');
        unpinned(root, ['margin-left']);
      } finally {
        spy.mockRestore();
      }
    });

    it('drops a pinned property the page removed, and the attribute if nothing is left', async () => {
      const { root, renderer, spy } = await pinned('<p>Paragraph text.</p>');
      try {
        root.style.removeProperty('text-indent');
        await renderer.setMode('bilingual');
        expect(root.hasAttribute('style')).toBe(false);
        expect(root.style.getPropertyValue('text-indent')).toBe('');
        unpinned(root);
      } finally {
        spy.mockRestore();
      }
    });

    it('stays without a style attribute when the page removed it', async () => {
      const { root, renderer, spy } = await pinned('<p style="color: red;">Paragraph text.</p>');
      try {
        root.removeAttribute('style');
        await renderer.setMode('bilingual');
        expect(root.hasAttribute('style')).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it('restores width with its !important while keeping a color the page changed', async () => {
      const { root, renderer, spy } = await pinned(
        '<p style="width: 50% !important; color: red;">Paragraph text.</p>',
      );
      try {
        root.style.setProperty('color', 'blue');
        await renderer.setMode('bilingual');
        expect(root.style.getPropertyValue('width')).toBe('50%');
        expect(root.style.getPropertyPriority('width')).toBe('important');
        expect(root.style.getPropertyValue('color')).toBe('blue');
        unpinned(root, ['width']);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('keeps auto margins and % padding responsive, and carries the root text spacing', async () => {
    // A centred `margin: 0 auto; padding: 5%` paragraph froze at its pixel margins (no longer
    // centred after a resize), and `letter-spacing: .2em` on the root reached the translation
    // as 0 once the root's font-size was zeroed (docs/reviews/2026-11-17-translation-only-followups.md).
    const { units, renderer } = await setup('<p>A centred paragraph of text.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    const root = unit.root as HTMLElement;
    await renderer.insert([{ unit, translation: '居中的一段文字。' }]);
    // What Chrome reports: getComputedStyle gives used pixels for margin and padding, the
    // Typed OM keeps `auto` and percentages and resolves em to pixels.
    const computed: Record<string, string> = {
      'margin-left': '242px',
      'margin-right': '242px',
      'padding-left': '50px',
      'padding-top': '16px',
      'letter-spacing': '3.2px',
      'word-spacing': '16px',
    };
    const typed: Record<string, string> = {
      'margin-left': 'auto',
      'margin-right': 'auto',
      'padding-left': '5%',
      'padding-top': '16px',
    };
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
      el === root
        ? ({
            fontSize: '16px',
            lineHeight: '24px',
            getPropertyValue: (name: string) => computed[name] ?? '0px',
          } as unknown as CSSStyleDeclaration)
        : real(el, pseudo),
    );
    Object.defineProperty(root, 'computedStyleMap', {
      configurable: true,
      value: () => ({ get: (name: string) => typed[name] ?? '0px' }),
    });
    try {
      await renderer.setMode('translation');
      expect(root.style.getPropertyValue('margin-left')).toBe('');
      expect(root.style.getPropertyValue('margin-right')).toBe('');
      expect(root.style.getPropertyValue('padding-left')).toBe('5%');
      expect(root.style.getPropertyValue('padding-top')).toBe('16px');
      const el = root.querySelector('et-tr') as HTMLElement;
      expect(el.style.getPropertyValue('--et-ls')).toBe('3.2px');
      expect(el.style.getPropertyValue('--et-ws')).toBe('16px');
      await renderer.setMode('bilingual');
      expect(root.hasAttribute('style')).toBe(false);
      expect(el.style.getPropertyValue('--et-ls')).toBe('');
      expect(el.style.getPropertyValue('--et-ws')).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('hides the original of a link paragraph whose tags were dropped, but keeps runs bilingual', async () => {
    // claude.dev: Google returned the sentence with `<t0>…</t0>` gone, the paragraph
    // fell back to plain text and its English stayed visible in translation-only.
    const { units, renderer, before } = await setup(
      '<p>Written and <a href="/x">reviewed by Claude</a>.</p><div>Run text here<p>Block text here.</p></div>',
    );
    const link = units.find((unit) => unit.seg.marks.length > 0);
    const run = units.find((unit) => unit.kind === 'run');
    if (!link || !run) throw new Error('missing units');
    await renderer.insert([
      { unit: link, translation: '由 Claude 编写和审查。' },
      { unit: run, translation: '运行' },
    ]);
    expect(link.root.querySelector('et-tr a')).toBeNull();
    await renderer.setMode('translation');
    expect(link.root.hasAttribute('data-et-only')).toBe(true);
    expect(run.root.hasAttribute('data-et-only')).toBe(false);
    await renderer.setMode('bilingual');
    expect(link.root.hasAttribute('data-et-only')).toBe(false);
    expect(link.root.querySelector(':scope > a')?.getAttribute('href')).toBe('/x');
    await renderer.restoreAll();
    expect(document.body.innerHTML).toBe(before);
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
    // The placeholder is plugin UI: the interface language, not the translation's.
    expect(tr?.getAttribute('lang')).toBe('zh-CN');
    tr?.querySelector('button')?.click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(renderer.isFailed(unit)).toBe(true);
    await renderer.insert([{ unit, translation: '每一次打断都有代价。' }]);
    expect(renderer.isFailed(unit)).toBe(false);
    expect(document.querySelectorAll('et-tr')).toHaveLength(1);
  });

  it('words the failure placeholder in the interface language, English included', async () => {
    const getMessage = createGetMessage(await loadLocales(), 'en');
    fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage;
    const { units } = await setup('<p>Every interruption costs attention.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    // A Japanese target: the placeholder's lang must not follow it.
    const renderer = createRenderer({ win: window, style: 'faded', target: 'ja', readStyle });
    await renderer.fail(unit, vi.fn());
    const tr = document.querySelector('et-tr');
    expect(tr?.textContent).toBe('Not translated ·Retry');
    expect(tr?.getAttribute('lang')).toBe('en');
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

describe('renderer: writes racing a restore', () => {
  it('drops an insert still waiting for its frame when the restore begins', async () => {
    const { units, renderer, before } = await setup('<p>The best tools disappear.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    const inflight = renderer.insert([{ unit, translation: '最好的工具会消失。' }]);
    await renderer.restoreAll();
    await inflight;
    expect(document.body.innerHTML).toBe(before);
  });

  it('drops a failure notice still waiting for its frame', async () => {
    const { units, renderer, before } = await setup('<p>Another paragraph of text.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    const inflight = renderer.fail(unit, () => undefined, 'boom');
    await renderer.restoreAll();
    await inflight;
    expect(document.body.innerHTML).toBe(before);
  });

  it('never pins spacing after a restore began during a mode switch', async () => {
    const { units, renderer, before } = await setup('<p>Pinned margins stay behind.</p>');
    const [unit] = units;
    if (!unit) throw new Error('no unit');
    await renderer.insert([{ unit, translation: '钉住的边距会留下来。' }]);
    const inflight = renderer.setMode('translation');
    await renderer.restoreAll();
    await inflight;
    expect(document.body.innerHTML).toBe(before);
  });
});

// docs/dom-contract.md: export tools read these markers from a DOM clone without CSS.
// A failing test here is a breaking change for them: update the contract and CHANGELOG.md.
describe('renderer: DOM contract', () => {
  it('marks block, inline, translation-only and failed translations as documented', async () => {
    const { units, renderer } = await setup(
      '<p>Block paragraph text.</p>' +
        '<div>Run text here<p>Inner block text.</p></div>' +
        '<div style="display:flex"><span>Flex item</span><span>Second item</span></div>' +
        '<p>Failed paragraph text.</p>',
    );
    const [block, run, flex, failed] = [
      units.find((unit) => unit.root.textContent === 'Block paragraph text.'),
      units.find((unit) => unit.kind === 'run'),
      units.find((unit) => (unit.root as HTMLElement).style?.display === 'flex'),
      units.find((unit) => unit.root.textContent === 'Failed paragraph text.'),
    ];
    if (!block || !run || !flex || !failed) throw new Error('missing units');
    await renderer.insert([
      { unit: block, translation: '块' },
      { unit: run, translation: '片段' },
      { unit: flex, translation: '弹性' },
    ]);
    await renderer.fail(failed, () => {}, 'x');
    const trOf = (root: Element) => [...root.querySelectorAll('et-tr')].at(-1) as Element;

    const blockTr = trOf(block.root);
    expect(blockTr.localName).toBe('et-tr');
    expect(blockTr.getAttribute('lang')).toBe('zh-CN');
    expect(blockTr.hasAttribute('data-et-inline')).toBe(false);
    expect(blockTr.hasAttribute('data-et-state')).toBe(false);
    expect(blockTr.textContent).toBe('块');
    expect(trOf(run.root).hasAttribute('data-et-inline')).toBe(true);
    expect(trOf(flex.root).hasAttribute('data-et-inline')).toBe(true);
    expect(trOf(failed.root).getAttribute('data-et-state')).toBe('error');

    await renderer.setMode('translation');
    // Only block units are hidden; runs, flex items and failures stay bilingual.
    expect(block.root.hasAttribute('data-et-only')).toBe(true);
    for (const unit of [run, flex, failed]) {
      expect(unit.root.hasAttribute('data-et-only')).toBe(false);
    }
  });

  it('keeps the documented tag and attribute names for the plugin UI hosts', () => {
    expect([OWN_TAG, ISLE_TAG, SELECTION_TAG, OWN_ATTR]).toEqual([
      'ET-TR',
      'ET-ISLE',
      'ET-SELECTION',
      'data-et',
    ]);
  });
});
