// Which elements are translated, kept as-is, or treated as boundaries. Pure DOM
// reads (no writes); shared by discovery and segmentation.

/** Never descended into: their text is not prose, or not ours to touch. */
export const SKIP_TAGS: ReadonlySet<string> = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'SVG',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'MATH',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'BUTTON',
  'PRE',
  'HEAD',
  'OBJECT',
  'EMBED',
]);

/** Kept verbatim inside a unit (cloned whole), never translated. */
export const VERBATIM_TAGS: ReadonlySet<string> = new Set([
  'CODE',
  'KBD',
  'SAMP',
  'VAR',
  'IMG',
  'BR',
  'WBR',
  'PICTURE',
]);

/** Block boundaries regardless of CSS. */
export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'P',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'DD',
  'DT',
  'TD',
  'TH',
  'FIGCAPTION',
  'CAPTION',
  'SUMMARY',
  'ARTICLE',
  'SECTION',
  'HEADER',
  'FOOTER',
  'MAIN',
  'ASIDE',
  'UL',
  'OL',
  'DL',
  'TABLE',
  'TBODY',
  'THEAD',
  'TFOOT',
  'TR',
  'FIGURE',
  'FORM',
  'FIELDSET',
  'DETAILS',
  'HR',
  'ADDRESS',
]);

/** Inline regardless of CSS (flex/grid parents blockify their display). */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  'A',
  'SPAN',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'MARK',
  'S',
  'DEL',
  'INS',
  'SMALL',
  'SUB',
  'SUP',
  'ABBR',
  'CITE',
  'Q',
  'TIME',
  'LABEL',
  'FONT',
  'BDI',
  'BDO',
  'DFN',
  'RUBY',
  ...VERBATIM_TAGS,
]);

const SKIP_ROLES = new Set([
  'navigation',
  'button',
  'menu',
  'menubar',
  'tab',
  'tablist',
  'toolbar',
]);

/** Our own nodes. */
export const OWN_TAG = 'ET-TR';
export const OWN_ATTR = 'data-et';

/** Nodes other translators insert. */
const FOREIGN_CLASSES = ['immersive-translate-target-wrapper', 'fluent-read-bilingual-content'];

/** Skipped together with its whole subtree (cheap attribute checks only, no layout). */
export function isSkipped(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName) || el.tagName === OWN_TAG || el.tagName === 'NAV') return true;
  if (el.hasAttribute(OWN_ATTR)) return true;
  if (el.hasAttribute('hidden') || el.hasAttribute('inert')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const translate = el.getAttribute('translate');
  if (translate === 'no' || translate === 'false') return true;
  if (el.classList.contains('notranslate')) return true;
  if (FOREIGN_CLASSES.some((name) => el.classList.contains(name))) return true;
  const editable = el.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return true;
  const role = el.getAttribute('role');
  if (role && SKIP_ROLES.has(role)) return true;
  return false;
}

export type StyleReader = (el: Element) => { display: string } | undefined;

const FLEX_OR_GRID = /^(inline-)?(flex|grid)$/;

/**
 * Block or inline for unit boundaries. Semantic tags decide first; other
 * elements use computed display, except children of flex/grid containers,
 * whose computed display is always blockified: those use their inline
 * `style.display`, defaulting to inline.
 */
export function isInlineElement(el: Element, readStyle: StyleReader): boolean {
  if (BLOCK_TAGS.has(el.tagName)) return false;
  if (INLINE_TAGS.has(el.tagName)) return true;
  const parent = el.parentElement;
  const parentDisplay = parent ? readStyle(parent)?.display : undefined;
  if (parentDisplay && FLEX_OR_GRID.test(parentDisplay)) {
    const own = (el as HTMLElement).style?.display;
    return !own || own.startsWith('inline');
  }
  const display = readStyle(el)?.display;
  // 'none' says nothing about the box it would have (and translation-only mode
  // hides children itself): fall back to the tag, as when no style is known.
  if (!display || display === 'none') return el.tagName.includes('-') ? true : el.tagName !== 'DIV';
  return display.startsWith('inline') || display === 'contents';
}

/** Whether the element lays its children out as flex or grid items. */
export function isFlexOrGrid(el: Element, readStyle: StyleReader): boolean {
  const display = readStyle(el)?.display;
  return !!display && FLEX_OR_GRID.test(display);
}

/** A cached getComputedStyle: one read per element per pass. */
export function createStyleReader(view: Window = window): StyleReader {
  const cache = new WeakMap<Element, { display: string }>();
  return (el) => {
    let style = cache.get(el);
    if (!style) {
      const computed = view.getComputedStyle(el);
      style = { display: computed.display };
      cache.set(el, style);
    }
    return style;
  };
}
