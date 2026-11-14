// Keeps the line being read in place across mode switches and restores. Plain
// insertions rely on the browser's native scroll anchoring (overflow-anchor).

interface Anchor {
  target: Element;
  top: number;
  scroller: Element | undefined;
}

function scrollableAncestor(el: Element, win: Window): Element | undefined {
  let current = el.parentElement;
  while (current && current !== win.document.body && current !== win.document.documentElement) {
    const { overflowY } = win.getComputedStyle(current);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return undefined;
}

/** The element under the middle of the viewport, ignoring our own nodes. */
export function captureAnchor(win: Window): Anchor | undefined {
  const doc = win.document;
  let target = doc.elementFromPoint?.(win.innerWidth / 2, win.innerHeight / 2) ?? null;
  while (target && target.tagName === 'ET-TR') target = target.parentElement;
  if (!target || target === doc.body || target === doc.documentElement) return undefined;
  return {
    target,
    top: target.getBoundingClientRect().top,
    scroller: scrollableAncestor(target, win),
  };
}

/** Scrolls so the anchor is back where it was (inner scroll container first, else the window). */
export function restoreAnchor(anchor: Anchor | undefined, win: Window): void {
  if (!anchor?.target.isConnected) return;
  const delta = anchor.target.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) < 1) return;
  // 'instant': pages with `scroll-behavior: smooth` would otherwise animate the correction.
  if (anchor.scroller) anchor.scroller.scrollBy({ top: delta, behavior: 'instant' });
  else win.scrollBy({ top: delta, behavior: 'instant' });
}
