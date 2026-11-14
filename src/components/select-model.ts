// Pure keyboard and placement logic of <Select>: no React, no DOM, unit-tested.

export type ListKeyResult =
  | { type: 'move'; index: number }
  | { type: 'choose'; index: number }
  | { type: 'close'; restoreFocus: boolean }
  | { type: 'none' };

/** Handles a key pressed while the list is open; `active` may be -1 (nothing highlighted). */
export function listKey(key: string, active: number, count: number): ListKeyResult {
  if (count === 0)
    return key === 'Escape' ? { type: 'close', restoreFocus: true } : { type: 'none' };
  switch (key) {
    case 'ArrowDown':
      return { type: 'move', index: Math.min(count - 1, active + 1) };
    case 'ArrowUp':
      return { type: 'move', index: active < 0 ? count - 1 : Math.max(0, active - 1) };
    case 'Home':
    case 'PageUp':
      return { type: 'move', index: 0 };
    case 'End':
    case 'PageDown':
      return { type: 'move', index: count - 1 };
    case 'Enter':
    case ' ':
      return active >= 0 ? { type: 'choose', index: active } : { type: 'none' };
    case 'Escape':
      return { type: 'close', restoreFocus: true };
    case 'Tab':
      return { type: 'close', restoreFocus: false };
    default:
      return { type: 'none' };
  }
}

/**
 * Type-to-select: the next label (after `active`, wrapping) that starts with
 * `query`; a repeated single letter cycles through matches. -1 when none.
 */
export function typeahead(labels: readonly string[], active: number, query: string): number {
  const q = query.toLocaleLowerCase();
  if (q === '') return -1;
  const repeated = q.length > 1 && [...q].every((char) => char === q[0]);
  const needle = repeated ? q.slice(0, 1) : q;
  // Continuing a word keeps the current match when it still fits.
  const start = needle.length > 1 ? Math.max(active, 0) : active + 1;
  for (let step = 0; step < labels.length; step += 1) {
    const index = (start + step) % labels.length;
    if (labels[index]?.toLocaleLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

export interface Placement {
  side: 'below' | 'above';
  /** Viewport px of the list's top edge (below) or bottom edge (above, from the viewport bottom). */
  offset: number;
  left: number;
  width: number;
  maxHeight: number;
}

const GAP = 6;
const MARGIN = 8;

/** Opens below unless the list would not fit there and there is more room above. */
export function placeList(input: {
  trigger: { top: number; bottom: number; left: number; right: number; width: number };
  viewport: { width: number; height: number };
  /** Natural list height (estimated from the option count). */
  listHeight: number;
  minWidth: number;
  align: 'start' | 'end';
}): Placement {
  const { trigger, viewport, listHeight } = input;
  const below = viewport.height - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  const side = listHeight <= below || below >= above ? 'below' : 'above';
  const width = Math.min(Math.max(trigger.width, input.minWidth), viewport.width - MARGIN * 2);
  const preferred = input.align === 'end' ? trigger.right - width : trigger.left;
  const left = Math.min(Math.max(preferred, MARGIN), viewport.width - MARGIN - width);
  return {
    side,
    offset: side === 'below' ? trigger.bottom + GAP : viewport.height - trigger.top + GAP,
    left,
    width,
    maxHeight: Math.max(0, side === 'below' ? below : above),
  };
}
