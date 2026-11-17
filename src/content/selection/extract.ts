import { normalizeSelectionText } from './open';

// Plan 4.3 rule 1: the text the user sees in a selection, whitespace-normalized.
//
// The bootstrap (size-bound) snapshots `selection.toString()`, which already follows
// rendering in Chrome (no `display:none`, `<br>` as a line break), normalized: its cheap
// filters run on that. The runtime passes it here once, when it takes the selection (dot
// or card), and from then on uses only the result: the request and the source line are
// that one string. `toString()` still includes text that is laid out but not visible:
// - the original text that translation-only mode hides with `font-size:0`;
// - ruby annotations (`rt`, `rp`);
// - screen-reader-only text (taken out of flow and clipped to a pixel).
// When the range meets any of these, the text is put together by walking the range.
// The walk may only ever take less than `toString()`, never more: it also leaves out
// text hidden with `visibility`, form controls' own text and non-rendered elements.

/** Set on a paragraph whose original text translation-only mode hides (content/styles). */
const ONLY_ATTR = 'data-et-only';

/**
 * Their text is never part of what a selection shows. A local list: dom-rules' SKIP_TAGS
 * also skips visible text (buttons, <pre>), which a selection does show.
 */
const UNSELECTED_TAGS: ReadonlySet<string> = new Set([
  'SELECT',
  'OPTION',
  'TEXTAREA',
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
]);

/** `visibility` is inherited and a child may turn it back on: judged per text node. */
function isInvisible(element: Element | null, win: Window): boolean {
  if (!element) return false;
  const { visibility } = win.getComputedStyle(element);
  return visibility === 'hidden' || visibility === 'collapse';
}

/** Laid out, but nothing the user can see. */
function isUnseen(element: Element, win: Window): boolean {
  if (element.nodeName === 'RT' || element.nodeName === 'RP') return true;
  if (UNSELECTED_TAGS.has(element.nodeName)) return true;
  const style = win.getComputedStyle(element);
  if (style.display === 'none') return true;
  // Screen-reader-only text (`.sr-only`, `.visually-hidden`, `.screen-reader-text`):
  // out of flow, clipped away or squeezed into a pixel with the overflow hidden.
  if (style.position !== 'absolute' && style.position !== 'fixed') return false;
  if (style.clip.replace(/px|\s/g, '') === 'rect(0,0,0,0)' || style.clipPath === 'inset(50%)') {
    return true;
  }
  return (
    style.overflow === 'hidden' &&
    Number.parseFloat(style.width) <= 1 &&
    Number.parseFloat(style.height) <= 1
  );
}

/** Whether a rendered element starts a new line (block, list item, table part…). */
function breaksLine(element: Element, win: Window): boolean {
  // An empty value (no layout known) counts as inline: no break is invented.
  return !/^(inline|ruby|contents|$)/.test(win.getComputedStyle(element).display);
}

/**
 * The visible text of `range`, whitespace-normalized (consecutive whitespace becomes
 * one space, ends trimmed; nothing else changes). `rendered` is the selection's own
 * `toString()`, normalized: the answer whenever the range holds no unseen text.
 */
export function extractText(range: Range, win: Window, rendered: string): string {
  const root = range.commonAncestorContainer;
  const parent = root.nodeType === 1 ? (root as Element) : root.parentElement;
  // Inside hidden original text (a text node of a translation-only paragraph).
  if (root.nodeType === 3 && parent?.hasAttribute(ONLY_ATTR)) return '';
  if (root.nodeType === 3 && isInvisible(parent, win)) return '';
  for (let element = parent; element; element = element.parentElement) {
    if (isUnseen(element, win)) return '';
  }
  let text = '';
  let walked = false;
  // SHOW_ELEMENT | SHOW_TEXT. The filter runs in document order, so it builds the text
  // as it goes; FILTER_REJECT (2) skips a whole hidden subtree.
  const walker = win.document.createTreeWalker(root, 5, {
    acceptNode(node) {
      if (!range.intersectsNode(node)) return 2;
      if (node.nodeType === 3) {
        const owner = node.parentElement;
        if (owner?.hasAttribute(ONLY_ATTR) || isInvisible(owner, win)) {
          walked = true;
          return 2;
        }
        const data = (node as Text).data;
        const end = node === range.endContainer ? range.endOffset : data.length;
        text += data.slice(node === range.startContainer ? range.startOffset : 0, end);
        return 1;
      }
      const element = node as Element;
      if (isUnseen(element, win)) {
        walked = true;
        return 2;
      }
      if (element.nodeName === 'BR') text += '\n';
      else if (breaksLine(element, win)) text += ' ';
      return 1;
    },
  });
  while (walker.nextNode()) {
    // The filter does the work.
  }
  return walked ? normalizeSelectionText(text) : rendered;
}

/**
 * Plan 4.3 rule 1, last paragraph: a selection inside a page's open shadow root comes
 * out of `getRangeAt` as a range around the host. `getComposedRanges` (Chrome 137+)
 * gives the real one. Without it (or for a closed root) the answer is null: the caller
 * keeps the host range, whose text is `selection.toString()`, and anchors the dot at
 * the pointer. Undefined means the range is not around a shadow host.
 */
export function composedRange(selection: Selection, range: Range): Range | null | undefined {
  const container = range.startContainer;
  const host = container.childNodes[range.startOffset] as Element | undefined;
  const shadowRoot = host?.shadowRoot;
  if (!shadowRoot || range.endContainer !== container) return undefined;
  const compose = (
    selection as Selection & {
      getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[];
    }
  ).getComposedRanges;
  try {
    const found = compose?.call(selection, { shadowRoots: [shadowRoot] })[0];
    if (!found || found.collapsed) return null;
    const composed = (container.ownerDocument ?? (container as Document)).createRange();
    composed.setStart(found.startContainer, found.startOffset);
    composed.setEnd(found.endContainer, found.endOffset);
    return composed;
  } catch {
    return null;
  }
}
