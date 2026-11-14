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
  // Ruby readings (furigana) are pronunciation, not text to translate.
  'RT',
  'RP',
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

export interface LayoutStyle {
  display: string;
  position?: string;
  float?: string;
}

export type StyleReader = (el: Element) => LayoutStyle | undefined;

const FLEX_OR_GRID = /^(inline-)?(flex|grid)$/;

/** Tag-only guess when no usable style is known. */
function inlineByTag(el: Element): boolean {
  if (INLINE_TAGS.has(el.tagName) || el.tagName.includes('-')) return true;
  return el.tagName !== 'DIV';
}

/**
 * Block or inline for unit boundaries, by how the element is actually laid out
 * (as FluentRead's `isBlockBoundary` does): sites style `<a>` and `<span>` as
 * rows and cards, so the tag alone is not enough. Semantic block tags are always
 * boundaries; images, code and breaks are always inline content. Everything else
 * follows its computed display, so flex and grid items, which the browser
 * blockifies, are each their own unit: merging them would also glue their text
 * together, since the gaps between items are drawn by CSS, not written in text.
 *
 * Three blockified cases stay inside their sentence:
 * - out-of-flow boxes (screen-reader-only text, floated badges) are not lines
 *   of their own, so the tag decides, as before;
 * - items of an `inline-flex` / `inline-grid` chip belong to that one inline box;
 * - ruby (`display: ruby*`) is inline text with annotations.
 */
export function isInlineElement(el: Element, readStyle: StyleReader): boolean {
  if (BLOCK_TAGS.has(el.tagName)) return false;
  if (VERBATIM_TAGS.has(el.tagName)) return true;
  const style = readStyle(el);
  const display = style?.display;
  // 'none' says nothing about the box it would have (and translation-only mode
  // hides children itself): fall back to the tag, as when no style is known.
  if (!style || !display || display === 'none') return inlineByTag(el);
  const outOfFlow =
    style.position === 'absolute' ||
    style.position === 'fixed' ||
    (style.float !== undefined && style.float !== 'none');
  if (outOfFlow) return inlineByTag(el);
  const parent = el.parentElement;
  const parentDisplay = parent ? readStyle(parent)?.display : undefined;
  if (parentDisplay === 'inline-flex' || parentDisplay === 'inline-grid') return true;
  return display.startsWith('inline') || display.startsWith('ruby') || display === 'contents';
}

/** Whether the element lays its children out as flex or grid items. */
export function isFlexOrGrid(el: Element, readStyle: StyleReader): boolean {
  const display = readStyle(el)?.display;
  return !!display && FLEX_OR_GRID.test(display);
}

/** A cached getComputedStyle: one read per element per pass. */
export function createStyleReader(view: Window = window): StyleReader {
  const cache = new WeakMap<Element, LayoutStyle>();
  return (el) => {
    let style = cache.get(el);
    if (!style) {
      const computed = view.getComputedStyle(el);
      style = { display: computed.display, position: computed.position, float: computed.cssFloat };
      cache.set(el, style);
    }
    return style;
  };
}
