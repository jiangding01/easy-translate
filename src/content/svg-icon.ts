import type { EngineOption } from '@/lib/messaging/protocol';

// An engine's mark for the selection card and the page isle (each bundles its own copy,
// so keep this small): the vendor icon drawn path by path, never parsed from markup, or
// the short label in a small square when the engine has no icon. Styled by `.pi` / `.pf`.

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** A fresh, decorative element; the caller's button keeps the accessible name. */
export function engineMark(doc: Document, option: Pick<EngineOption, 'short' | 'icon'>): Element {
  const icon = option.icon;
  if (!icon) {
    const box = doc.createElement('span');
    box.className = 'pi pf';
    box.setAttribute('aria-hidden', 'true');
    box.textContent = option.short;
    return box;
  }
  const root = doc.createElementNS(SVG_NS, 'svg');
  root.setAttribute('class', 'pi');
  root.setAttribute('viewBox', icon.viewBox);
  root.setAttribute('aria-hidden', 'true');
  for (const part of icon.paths) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', part.d);
    path.setAttribute('fill', part.fill ?? 'currentColor');
    if (part.opacity !== undefined) path.setAttribute('fill-opacity', String(part.opacity));
    if (part.evenOdd) path.setAttribute('fill-rule', 'evenodd');
    root.append(path);
  }
  return root;
}

const shown = new WeakMap<Element, unknown>();

/** Shows `option`'s mark in `slot` ("…" before the engines load); a no-op when unchanged. */
export function showMark(
  doc: Document,
  slot: Element,
  option: Pick<EngineOption, 'short' | 'icon'> | undefined,
) {
  if (slot.firstChild && shown.get(slot) === option) return;
  shown.set(slot, option);
  slot.replaceChildren(option ? engineMark(doc, option) : '…');
}
