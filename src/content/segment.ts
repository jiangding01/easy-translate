import { isSkipped, VERBATIM_TAGS } from './dom-rules';
import { collapseWhitespace, digest } from './text';

// A unit's content ⇄ the text sent to the engine. Inline markup becomes short
// tags (<t0>…</t0>, <t1/>) that point back to the original elements; the
// translation is rebuilt from clones of those elements and text nodes only.
// Engine output is never parsed as HTML and never contributes attributes.

/** Tag letters tried in order; the first one absent from the source wins (deterministic). */
const PREFIXES = ['t', 'u', 'w', 'z', 'tt', 'uu'] as const;

type Marked = { kind: 'pair' | 'void'; source: Element };

export interface Segment {
  /** What is sent: plain text, or text with tags when inline markup was found. */
  text: string;
  /** Tag letter(s) used, or '' when no tags are present. */
  prefix: string;
  marks: Marked[];
  /** Plain source text (tags removed), for digests and fallbacks. */
  plain: string;
  digest: string;
  /** The single inline element wrapping all of the unit's text, if any (e.g. a title link). */
  soleWrapper?: Element;
}

/** Cloned whole, never translated: verbatim tags, plus role=img (skipped, but an inline emoji must survive). */
function isVerbatim(el: Element): boolean {
  return VERBATIM_TAGS.has(el.tagName) || el.getAttribute('role') === 'img';
}

function sourceHasPrefix(source: string, prefix: string): boolean {
  return new RegExp(`</?${prefix}\\d`).test(source);
}

/** Serializes the unit's nodes (a whole element's children, or an inline run). */
export function segment(nodes: readonly Node[]): Segment {
  const rawText = nodes.map((node) => node.textContent ?? '').join('');
  const prefix = PREFIXES.find((candidate) => !sourceHasPrefix(rawText, candidate));
  const marks: Marked[] = [];
  const out: string[] = [];
  const plainOut: string[] = [];

  const visit = (node: Node, tagged: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      out.push(value);
      plainOut.push(value);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (isSkipped(el) && !isVerbatim(el)) return;
    if (isVerbatim(el)) {
      if (tagged) {
        out.push(`<${prefix}${marks.length}/>`);
        marks.push({ kind: 'void', source: el });
      } else {
        out.push(el.textContent ?? '');
      }
      plainOut.push(el.tagName === 'BR' ? ' ' : (el.textContent ?? ''));
      return;
    }
    if (!tagged || !(el.textContent ?? '').trim()) {
      for (const child of el.childNodes) visit(child, tagged);
      return;
    }
    const id = marks.length;
    marks.push({ kind: 'pair', source: el });
    out.push(`<${prefix}${id}>`);
    for (const child of el.childNodes) visit(child, tagged);
    out.push(`</${prefix}${id}>`);
  };

  const tagged = prefix !== undefined;
  for (const node of nodes) visit(node, tagged);

  const plain = collapseWhitespace(plainOut.join('')).trim();
  // No inline markup at all: send plain text, nothing to restore.
  const text = marks.length > 0 ? collapseWhitespace(out.join('')).trim() : plain;
  return {
    text,
    prefix: marks.length > 0 && prefix ? prefix : '',
    marks: marks.length > 0 ? marks : [],
    plain,
    digest: digest(text),
    soleWrapper: findSoleWrapper(nodes),
  };
}

function findSoleWrapper(nodes: readonly Node[]): Element | undefined {
  const meaningful = nodes.filter(
    (node) => node.nodeType === Node.ELEMENT_NODE || (node.nodeValue ?? '').trim() !== '',
  );
  if (meaningful.length !== 1) return undefined;
  const only = meaningful[0];
  if (!only || only.nodeType !== Node.ELEMENT_NODE) return undefined;
  const el = only as Element;
  return isVerbatim(el) || isSkipped(el) ? undefined : el;
}

// ------------------------------------------------------------ restore

type Token = { type: 'text'; value: string } | { type: 'open' | 'close' | 'void'; id: number };

function tokenize(text: string, prefix: string): Token[] {
  const tokens: Token[] = [];
  const pattern = new RegExp(`<(/?)${prefix}(\\d{1,3})\\s*(/?)>`, 'g');
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: 'text', value: text.slice(last, index) });
    const id = Number(match[2]);
    tokens.push({ type: match[1] ? 'close' : match[3] ? 'void' : 'open', id });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

/** Removes tags of this segment's prefix, for the plain-text fallback. */
export function stripTags(text: string, prefix: string): string {
  if (!prefix) return text;
  return collapseWhitespace(
    text.replace(new RegExp(`<\\/?${prefix}\\d{1,3}\\s*\\/?>`, 'g'), ''),
  ).trim();
}

const UNSAFE_ATTRIBUTE = /^on|^(srcdoc|formaction|id)$/i;
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Shallow or deep clone without event handlers, ids or unsafe links. */
export function sanitizedClone(source: Element, deep: boolean): Element {
  const clone = source.cloneNode(deep) as Element;
  const scrub = (el: Element) => {
    for (const attribute of [...el.attributes]) {
      if (UNSAFE_ATTRIBUTE.test(attribute.name)) el.removeAttribute(attribute.name);
    }
    if (el.tagName === 'A' && el.hasAttribute('href')) {
      // `.protocol` is resolved against the page, so relative links stay.
      if (!SAFE_PROTOCOLS.has((el as HTMLAnchorElement).protocol)) el.removeAttribute('href');
    }
  };
  scrub(clone);
  if (deep) for (const el of clone.querySelectorAll('*')) scrub(el);
  return clone;
}

/**
 * Rebuilds a translation into nodes: tags map back to clones of the original
 * elements, everything else is text. Returns undefined when the tags do not
 * round-trip exactly (missing, duplicated, crossed or unknown), so the caller
 * falls back to plain text.
 */
export function restoreTranslation(
  translation: string,
  seg: Segment,
  doc: Document,
): DocumentFragment | undefined {
  const fragment = doc.createDocumentFragment();
  if (!seg.prefix) {
    fragment.append(doc.createTextNode(translation));
    return fragment;
  }
  const seen = new Set<number>();
  const stack: { id: number; node: ParentNode }[] = [{ id: -1, node: fragment }];
  for (const token of tokenize(translation, seg.prefix)) {
    const parent = stack[stack.length - 1]?.node ?? fragment;
    if (token.type === 'text') {
      parent.append(doc.createTextNode(token.value));
      continue;
    }
    const mark = seg.marks[token.id];
    if (!mark) return undefined;
    if (token.type === 'close') {
      const top = stack.pop();
      if (!top || top.id !== token.id) return undefined;
      continue;
    }
    if (seen.has(token.id)) return undefined;
    seen.add(token.id);
    if (token.type === 'void') {
      if (mark.kind !== 'void') return undefined;
      parent.append(sanitizedClone(mark.source, true));
      continue;
    }
    if (mark.kind !== 'pair') return undefined;
    const clone = sanitizedClone(mark.source, false);
    parent.append(clone);
    stack.push({ id: token.id, node: clone });
  }
  if (stack.length !== 1 || seen.size !== seg.marks.length) return undefined;
  return fragment;
}

/** Plain-text fallback; keeps a lone wrapping element (a title link) around the text. */
export function plainTranslation(
  translation: string,
  seg: Segment,
  doc: Document,
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const text = doc.createTextNode(stripTags(translation, seg.prefix));
  if (seg.soleWrapper) {
    const wrapper = sanitizedClone(seg.soleWrapper, false);
    wrapper.append(text);
    fragment.append(wrapper);
  } else {
    fragment.append(text);
  }
  return fragment;
}
