import type { PageMode, PageStyle } from '@/lib/config/types';
import type { LanguageCode } from '@/lib/languages';
import { captureAnchor, restoreAnchor } from './anchor';
import type { Unit } from './discover';
import { isFlexOrGrid, isSkipped, OWN_TAG, type StyleReader, VERBATIM_TAGS } from './dom-rules';
import { plainTranslation, restoreTranslation, segment } from './segment';

// Puts translations into the page and takes them out again. Never rewrites or
// moves host nodes: only inserts <et-tr> and sets a few attributes, all undone
// on restore. Reads layout first, writes in one animation frame, animates with
// interruptible Web Animations on opacity/filter only.

export interface RenderOptions {
  win: Window;
  style: PageStyle;
  target: LanguageCode;
  readStyle: StyleReader;
}

interface Rendered {
  unit: Unit;
  el: HTMLElement;
  inline: boolean;
  failed: boolean;
  /** Translation-only patch: the root's original style attribute. */
  only?: { styleAttr: string | null };
  unclamped?: Element;
  animation?: Animation;
}

export interface Result {
  unit: Unit;
  translation: string;
}

export interface Renderer {
  /** Inserts translations; units that changed or left the page are skipped and returned. */
  insert(results: readonly Result[]): Promise<Unit[]>;
  /** Shows "未译出 · 重试" where the translation would go. */
  fail(unit: Unit, onRetry: () => void, detail?: string): Promise<void>;
  /** Removes one unit's translation at once (source changed, retry). */
  drop(unit: Unit): void;
  setMode(mode: PageMode): Promise<void>;
  /** Restyles every translation in place (the setting changed while translating). */
  setStyle(style: PageStyle): void;
  /** Fades visible translations out, then removes everything in one frame. */
  restoreAll(): Promise<void>;
  has(unit: Unit): boolean;
  isFailed(unit: Unit): boolean;
  /** The unit's source is still in the page with the same text (it may be hidden for now). */
  isCurrent(unit: Unit): boolean;
  /** Units whose translation is no longer in the page (framework re-render). */
  detached(): Unit[];
  readonly mode: PageMode;
}

const APPEAR_MS = 200;
const STAGGER_MS = 30;
const MAX_STAGGERED = 6;
const VANISH_MS = 140;
const SWAP_HALF_MS = 60;
const REDUCED_MS = 100;

/** Closest non-transparent background is dark (luminance < 0.4); checks up to 8 ancestors. */
function readHostDark(el: Element, win: Window): boolean {
  let current: Element | null = el;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const match = win.getComputedStyle(current).backgroundColor.match(/rgba?\(([^)]+)\)/);
    if (match?.[1]) {
      const [r = 255, g = 255, b = 255, a = 1] = match[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      if (a > 0.05) {
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) < 0.4;
      }
    }
    current = current.parentElement;
  }
  return false;
}

function findClamp(root: Element, win: Window): Element | undefined {
  let current: Element | null = root;
  for (let depth = 0; current && depth < 3; depth += 1) {
    const style = win.getComputedStyle(current) as CSSStyleDeclaration & {
      webkitLineClamp?: string;
    };
    const clamp = style.webkitLineClamp ?? style.getPropertyValue('-webkit-line-clamp');
    if (clamp && clamp !== 'none') return current;
    current = current.parentElement;
  }
  return undefined;
}

function inViewport(el: Element, win: Window): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth
  );
}

/** Where an inline translation goes in a flex/grid root: after the last piece of text. */
function inlineSpot(root: Element): { parent: Node; before: Node | null } {
  for (let index = root.childNodes.length - 1; index >= 0; index -= 1) {
    const child = root.childNodes[index] as Node;
    if (child.nodeType === Node.TEXT_NODE && (child.nodeValue ?? '').trim()) {
      return { parent: root, before: child.nextSibling };
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (isSkipped(el) || !(el.textContent ?? '').trim()) continue;
      if (VERBATIM_TAGS.has(el.tagName)) return { parent: root, before: el.nextSibling };
      return { parent: el, before: null };
    }
  }
  return { parent: root, before: null };
}

export function createRenderer(options: RenderOptions): Renderer {
  const { win, readStyle } = options;
  const doc = win.document;
  const rendered = new Map<Unit, Rendered>();
  const hostDark = new WeakMap<Element, boolean>();
  let mode: PageMode = 'bilingual';
  let style = options.style;
  /**
   * Set when the restore begins. Writes still waiting for their frame (insert,
   * fail, a mode switch) must not land after it, or they would outlive the session.
   */
  let disposed = false;

  const reduced = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const frame = () =>
    new Promise<void>((resolve) => {
      if (win.requestAnimationFrame) win.requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  const isDark = (root: Element) => {
    let dark = hostDark.get(root);
    if (dark === undefined) {
      dark = readHostDark(root, win);
      hostDark.set(root, dark);
    }
    return dark;
  };

  function makeElement(dark: boolean, inline: boolean): HTMLElement {
    const el = doc.createElement('et-tr');
    el.setAttribute('data-et-s', style);
    el.setAttribute('lang', options.target);
    el.setAttribute('translate', 'no');
    el.setAttribute('dir', 'auto');
    if (dark) el.setAttribute('data-et-host', 'dark');
    if (inline) el.setAttribute('data-et-inline', '');
    return el;
  }

  function appear(record: Rendered, delay: number) {
    if (typeof record.el.animate !== 'function') return;
    const soft = reduced();
    record.el.style.willChange = soft ? 'opacity' : 'opacity, filter';
    const animation = record.el.animate(
      soft ? [{ opacity: 0 }, {}] : [{ opacity: 0, filter: 'blur(2px)' }, { filter: 'blur(0px)' }],
      {
        duration: soft ? REDUCED_MS : APPEAR_MS,
        delay,
        easing: 'cubic-bezier(.2,0,0,1)',
        fill: 'backwards',
      },
    );
    record.animation = animation;
    const done = () => {
      if (record.animation === animation) record.animation = undefined;
      record.el.style.removeProperty('will-change');
    };
    animation.finished.then(done, done);
  }

  function place(record: Rendered, flexRoot: boolean) {
    const { unit, el } = record;
    if (unit.kind === 'run') {
      const last = unit.nodes[unit.nodes.length - 1];
      if (last?.parentNode) last.parentNode.insertBefore(el, last.nextSibling);
      return;
    }
    if (flexRoot) {
      const spot = inlineSpot(unit.root);
      spot.parent.insertBefore(el, spot.before);
      return;
    }
    unit.root.append(el);
  }

  // A paragraph whose link tags did not survive is hidden too: in translation-only
  // its links are unreachable until the reader switches back to bilingual.
  function canBeOnly(record: Rendered): boolean {
    return record.unit.kind === 'block' && !record.inline && !record.failed;
  }

  type OnlyReading = {
    record: Rendered;
    fontSize: string;
    lineHeight: string;
    pins: [string, string][];
  };
  // font-size:0 also zeroes the root's own em/ch lengths (`max-width: 80ch` would
  // stack the translation one character per line), so these are pinned in pixels.
  // getComputedStyle gives computed values here: em/ch resolved, keywords and % kept.
  const PINNED = [
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'flex-basis',
    'text-indent',
  ];
  // getComputedStyle reports used pixels for these even when they are `auto`;
  // the Typed OM keeps the keyword, so only a real length gets pinned.
  const PINNED_TYPED = ['width', 'height'];
  const KEYWORD = /^[a-z-]+$/;
  function readOnly(record: Rendered): OnlyReading {
    const root = record.unit.root;
    const style = win.getComputedStyle(root);
    const typed = typeof root.computedStyleMap === 'function' ? root.computedStyleMap() : null;
    const pins: [string, string][] = PINNED.map((name) => [name, style.getPropertyValue(name)]);
    for (const name of PINNED_TYPED) pins.push([name, String(typed?.get(name) ?? '')]);
    return { record, fontSize: style.fontSize, lineHeight: style.lineHeight, pins };
  }
  function applyOnly({ record, fontSize, lineHeight, pins }: OnlyReading) {
    if (record.only) return;
    const root = record.unit.root as HTMLElement;
    record.only = { styleAttr: root.getAttribute('style') };
    // Keywords (auto, none) are left to the host so its own rules keep applying.
    for (const [name, value] of pins) {
      if (value && !KEYWORD.test(value)) root.style.setProperty(name, value);
    }
    root.setAttribute('data-et-only', '');
    record.el.style.setProperty('--et-fs', fontSize);
    record.el.style.setProperty('--et-lh', lineHeight);
  }
  function removeOnly(record: Rendered) {
    if (!record.only) return;
    const root = record.unit.root;
    root.removeAttribute('data-et-only');
    if (record.only.styleAttr === null) root.removeAttribute('style');
    else root.setAttribute('style', record.only.styleAttr);
    record.el.style.removeProperty('--et-fs');
    record.el.style.removeProperty('--et-lh');
    record.only = undefined;
  }

  function detach(record: Rendered) {
    record.animation?.cancel();
    removeOnly(record);
    record.el.remove();
    record.unclamped?.removeAttribute('data-et-unclamp');
  }

  function stillSame(unit: Unit): boolean {
    if (!unit.root.isConnected) return false;
    if (unit.kind === 'run' && unit.nodes.some((node) => node.parentNode !== unit.root))
      return false;
    const nodes =
      unit.kind === 'block'
        ? [...unit.root.childNodes].filter((n) => n.nodeName !== OWN_TAG)
        : unit.nodes;
    return segment(nodes).digest === unit.seg.digest;
  }

  return {
    get mode() {
      return mode;
    },

    has: (unit) => rendered.has(unit) && !rendered.get(unit)?.failed,
    isFailed: (unit) => rendered.get(unit)?.failed === true,
    isCurrent: (unit) => stillSame(unit),

    detached: () =>
      [...rendered.values()].filter((record) => !record.el.isConnected).map((r) => r.unit),

    async insert(results) {
      // Read phase: everything that touches layout, before any write.
      const stale: Unit[] = [];
      const plans: {
        result: Result;
        flexRoot: boolean;
        visible: boolean;
        dark: boolean;
        clamp?: Element;
      }[] = [];
      for (const result of results) {
        const { unit } = result;
        if (!stillSame(unit)) {
          stale.push(unit);
          continue;
        }
        const flexRoot = unit.kind === 'block' && isFlexOrGrid(unit.root, readStyle);
        plans.push({
          result,
          flexRoot,
          visible: inViewport(unit.root, win),
          dark: isDark(unit.root),
          clamp: findClamp(unit.root, win),
        });
      }
      if (plans.length === 0 || disposed) return stale;
      await frame();
      if (disposed) return stale;

      // Write phase: one frame for the whole batch.
      const onlyReadings: OnlyReading[] = [];
      const fresh: Rendered[] = [];
      let staggered = 0;
      for (const { result, flexRoot, visible, dark, clamp } of plans) {
        const { unit, translation } = result;
        const previous = rendered.get(unit);
        if (previous) detach(previous);
        const inline = unit.kind === 'run' || flexRoot;
        const rebuilt = restoreTranslation(translation, unit.seg, doc);
        const content = rebuilt ?? plainTranslation(translation, unit.seg, doc);
        const record: Rendered = {
          unit,
          el: makeElement(dark, inline),
          inline,
          failed: false,
        };
        record.el.append(content);
        place(record, flexRoot);
        if (clamp) {
          clamp.setAttribute('data-et-unclamp', '');
          record.unclamped = clamp;
        }
        rendered.set(unit, record);
        fresh.push(record);
        if (visible) {
          appear(record, Math.min(staggered, MAX_STAGGERED) * STAGGER_MS);
          staggered += 1;
        }
      }
      if (mode === 'translation') {
        for (const record of fresh) if (canBeOnly(record)) onlyReadings.push(readOnly(record));
        for (const reading of onlyReadings) applyOnly(reading);
      }
      return stale;
    },

    async fail(unit, onRetry, detail) {
      if (!unit.root.isConnected) return;
      const dark = isDark(unit.root);
      const flexRoot = unit.kind === 'block' && isFlexOrGrid(unit.root, readStyle);
      if (disposed) return;
      await frame();
      if (disposed) return;
      const previous = rendered.get(unit);
      if (previous) detach(previous);
      const inline = unit.kind === 'run' || flexRoot;
      const record: Rendered = {
        unit,
        el: makeElement(dark, inline),
        inline,
        failed: true,
      };
      record.el.setAttribute('data-et-state', 'error');
      if (detail) record.el.title = detail;
      record.el.append(doc.createTextNode('未译出'));
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = '重试';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onRetry();
      });
      record.el.append(doc.createTextNode(' ·'), button);
      place(record, flexRoot);
      rendered.set(unit, record);
      appear(record, 0);
    },

    setStyle(next) {
      style = next;
      for (const record of rendered.values()) record.el.setAttribute('data-et-s', next);
    },

    drop(unit) {
      const record = rendered.get(unit);
      if (!record) return;
      detach(record);
      rendered.delete(unit);
    },

    async setMode(next) {
      if (next === mode || disposed) return;
      const switchable = () =>
        [...rendered.values()].filter((record) => record.el.isConnected && canBeOnly(record));
      const records = switchable();
      const anchor = captureAnchor(win);
      const visibleRoots = records.map((r) => r.unit.root).filter((root) => inViewport(root, win));
      const animated = typeof doc.body.animate === 'function' && !reduced();
      // First half: the visible paragraphs fade out together. Only our own
      // animations are tracked and cancelled: the host's stay untouched.
      const fades: Animation[] = [];
      if (animated && visibleRoots.length > 0) {
        for (const root of visibleRoots) {
          fades.push(
            root.animate([{}, { opacity: 0 }], {
              duration: SWAP_HALF_MS,
              easing: 'ease-in',
              fill: 'forwards',
            }),
          );
        }
        await Promise.all(fades.map((fade) => fade.finished.catch(() => undefined)));
        if (disposed) {
          for (const fade of fades) fade.cancel();
          return;
        }
      }
      // Re-read: translations inserted during the fade must switch too.
      const current = switchable();
      const readings = next === 'translation' ? current.map(readOnly) : [];
      mode = next;
      if (next === 'translation') for (const reading of readings) applyOnly(reading);
      else for (const record of current) removeOnly(record);
      restoreAnchor(anchor, win);
      // Second half: fade back in, then drop our animations so host styles rule again.
      if (animated && visibleRoots.length > 0) {
        for (const fade of fades) fade.cancel();
        for (const root of visibleRoots) {
          root.animate([{ opacity: 0 }, {}], { duration: SWAP_HALF_MS, easing: 'ease-out' });
        }
      }
    },

    async restoreAll() {
      disposed = true;
      const records = [...rendered.values()];
      const anchor = captureAnchor(win);
      const animated = typeof doc.body.animate === 'function';
      if (animated) {
        const soft = reduced();
        // Read every starting point first, then animate from where each one is now.
        const starts = records
          .filter((record) => record.el.isConnected && inViewport(record.el, win))
          .map((record) => {
            const style = win.getComputedStyle(record.el);
            return {
              record,
              opacity: style.opacity,
              filter: style.filter === 'none' ? 'blur(0px)' : style.filter,
            };
          });
        await Promise.all(
          starts.map(({ record, opacity, filter }) => {
            record.animation?.cancel();
            return record.el
              .animate(
                [
                  { opacity, filter },
                  { opacity: 0, filter: soft ? filter : 'blur(2px)' },
                ],
                {
                  duration: soft ? REDUCED_MS : VANISH_MS,
                  easing: 'cubic-bezier(.4,0,1,1)',
                  fill: 'forwards',
                },
              )
              .finished.catch(() => undefined);
          }),
        );
      }
      await frame();
      for (const record of records) detach(record);
      rendered.clear();
      mode = 'bilingual';
      restoreAnchor(anchor, win);
    },
  };
}
