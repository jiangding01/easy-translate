// Where the card goes (plan 4.3 rule 5). Pure: viewport coordinates in, a rectangle out.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  w: number;
  h: number;
}

/** `fixed`: no selection to follow, the top edge stays where it was put. */
export type Side = 'below' | 'above' | 'over' | 'fixed';

export interface Placement {
  x: number;
  y: number;
  w: number;
  /** The card's height limit here; the content scrolls inside beyond it. */
  maxH: number;
  side: Side;
  /** The lowest the card's bottom edge may go: the viewport's, or above a bottom isle. */
  floor: number;
}

export const CARD_WIDTH = 360;
/** The card is never taller than this; longer translations scroll. */
export const CARD_MAX_HEIGHT = 380;
/**
 * Space between a card flipped above and the selection's first line. Below, there is none:
 * the card's top edge is the last line's bottom, where the dot sits.
 */
export const GAP = 2;
/** The card stays this far inside the viewport. */
export const EDGE = 8;
/** Less room than this on both sides: the card overlaps the selection instead. */
export const MIN_ROOM = 120;
/**
 * The dot's center sits this far right of the last character: its 5px radius plus 2px of
 * air, so it never covers a closing punctuation mark yet stays against the text.
 */
export const DOT_OFFSET = 7;

export const cardWidth = (viewport: Size) => Math.min(CARD_WIDTH, viewport.w - 2 * EDGE);

/**
 * A rough height before anything is measured, from the source length: header (40),
 * source line (27), the translation's lines (24 each), padding (14) and footer (40).
 */
export function estimateHeight(sourceLength: number, width = CARD_WIDTH): number {
  const chars = Math.max(2, Math.round(sourceLength * 0.6));
  const lines = Math.max(1, Math.ceil((chars * 9) / (width - 28)));
  return Math.min(CARD_MAX_HEIGHT, 121 + lines * 24);
}

type Point = { x: number; y: number };

/** The dot's center kept inside the viewport (its hit zone, mostly). */
export function clampDot(p: Point, viewport: Size): Point {
  return {
    x: Math.max(12, Math.min(viewport.w - 12, p.x)),
    y: Math.max(10, Math.min(viewport.h - 10, p.y)),
  };
}

/**
 * The dot's center for a selection ending at `anchor` (the last character's bottom right,
 * plan 1.3 rule 5): on the bottom edge of the last character's line, just right of it.
 * It never moves for where the pointer was released (a resting hand is the hover rule's
 * concern), so it never drifts off the text into the blank space after a line.
 */
export function dotAt(anchor: Point, viewport: Size): Point {
  return clampDot({ x: anchor.x + DOT_OFFSET, y: anchor.y }, viewport);
}

/** The viewport edge the isle rests on: the one its rectangle is closest to. */
function dockOf(isle: Box, viewport: Size): 'left' | 'right' | 'bottom' {
  const left = isle.left;
  const right = viewport.w - isle.right;
  const bottom = viewport.h - isle.bottom;
  if (bottom <= left && bottom <= right) return 'bottom';
  return left < right ? 'left' : 'right';
}

/** Whether [a0, a1] comes within `EDGE` of [b0, b1]. */
const near = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 + EDGE && a1 > b0 - EDGE;

/** Where a card below the selection has its top edge: on the dot, never over the selection. */
const belowTop = (selection: Box, dot: Point) => Math.max(dot.y, selection.bottom);

/**
 * The card grows out of the dot: one of its top corners is the dot's center. It grows to
 * the right (top left corner on the dot) when that fits inside the viewport and clear of a
 * side-docked isle, else to the left (top right corner); when neither does, the half of the
 * viewport the dot is in decides and the card is clamped. Its top edge is the last line's
 * bottom (the dot's row), with no gap. When it does not fit below, it flips above the selection: its bottom corner on the same side sits `GAP`
 * above the first line's top (no longer on the dot, but never over the selection); when it
 * fits on neither side, the roomier one with the height limited to its room. The card
 * never covers the selection's lines (the whole range, not only the last line) unless
 * neither side has even `MIN_ROOM`: then it rests at the bottom. It stays 8px inside the
 * viewport (clamping moves it off the dot horizontally, the top edge stays) and 8px clear
 * of the `isle` (the page isle's rectangle, when there is one): beside a side-docked
 * isle, above a bottom-docked one, but only when the card would otherwise come that
 * close: a bottom isle it clears horizontally, or a side isle it clears vertically (over
 * the whole height it may grow to), is ignored. `height` is the height to fit (an
 * estimate, or the measured one), `dot` the dot's center (see `dotAt`).
 */
export function placeCard(
  selection: Box,
  dot: Point,
  height: number,
  viewport: Size,
  isle?: Box,
): Placement {
  const w = cardWidth(viewport);
  const dock = isle && dockOf(isle, viewport);
  const want = Math.min(CARD_MAX_HEIGHT, height);
  const top = belowTop(selection, dot);
  const above = selection.top - GAP - EDGE;
  const cap = (room: number) => Math.min(CARD_MAX_HEIGHT, room);
  const maxX = viewport.w - EDGE - w;
  // Too narrow to clear both: the viewport edge wins.
  const clampX = (grown: number) => Math.max(EDGE, Math.min(maxX, grown));

  /** The card with its left edge at `x`, and whether a side isle sits in its way. */
  const layout = (x: number) => {
    let floor = viewport.h - EDGE;
    if (isle && dock === 'bottom' && near(x, x + w, isle.left, isle.right)) {
      floor = Math.min(floor, isle.top - EDGE);
    }
    const below = floor - top;
    let side: Side;
    if (below >= want) side = 'below';
    else if (above >= want) side = 'above';
    else if (Math.max(below, above) >= MIN_ROOM) side = below >= above ? 'below' : 'above';
    else side = 'over';
    let placement: Placement;
    if (side === 'below') {
      placement = { x, y: top, w, maxH: cap(below), side, floor };
    } else if (side === 'over') {
      const over = cap(floor - EDGE);
      placement = { x, y: floor - Math.min(want, over), w, maxH: over, side, floor };
    } else {
      // Above: the bottom edge stays put and the card grows upward (see cardTop).
      const maxH = cap(above);
      placement = { x, y: selection.top - GAP - Math.min(want, maxH), w, maxH, side, floor };
    }
    let crowded = false;
    if (isle && dock !== 'bottom') {
      // The span the card may take as it grows: down from its top below the selection,
      // up from its bottom edge otherwise.
      const reach =
        side === 'below'
          ? placement.y
          : (side === 'above' ? selection.top - GAP : floor) - placement.maxH;
      crowded = near(reach, reach + placement.maxH, isle.top, isle.bottom);
    }
    return {
      placement,
      crowded,
      clear: !crowded || !near(x, x + w, isle?.left ?? 0, isle?.right ?? 0),
    };
  };

  // Right first (top left corner on the dot), then left (top right corner on the dot): the
  // first one that is inside the viewport and clear of a side isle.
  for (const x of [dot.x, dot.x - w]) {
    if (x < EDGE || x > maxX) continue;
    const tried = layout(x);
    if (tried.clear) return tried.placement;
  }

  // Neither does: the old fallback. The half the dot is in picks the side, the card is
  // clamped into the viewport, and a side isle then pushes it away.
  const { placement, crowded } = layout(clampX(dot.x >= viewport.w / 2 ? dot.x - w : dot.x));
  if (isle && crowded) {
    placement.x =
      dock === 'right'
        ? clampX(Math.min(maxX, isle.left - EDGE - w))
        : clampX(Math.max(EDGE, isle.right + EDGE));
  }
  return placement;
}

/**
 * The top edge for a card of height `h` (as its content grows) on the chosen side: below,
 * on the dot (it follows the selection as the page scrolls).
 */
export function cardTop(
  selection: Box,
  dot: Point,
  placement: Placement,
  h: number,
  viewport: Size,
): number {
  if (placement.side === 'below') return belowTop(selection, dot);
  if (placement.side === 'above') return selection.top - GAP - h;
  if (placement.side === 'fixed') return placement.y;
  return Math.min(placement.floor, viewport.h - EDGE) - h;
}

/**
 * The card with no selection to follow (an iframe's text, or a menu text that differs
 * from the page selection): centered horizontally, on the upper third line.
 */
export function placeDetached(height: number, viewport: Size): Placement {
  const w = cardWidth(viewport);
  const maxH = Math.min(CARD_MAX_HEIGHT, viewport.h - 2 * EDGE);
  const h = Math.min(height, maxH);
  const y = Math.max(EDGE, Math.min(viewport.h - EDGE - h, Math.round(viewport.h / 3 - h / 2)));
  const floor = viewport.h - EDGE;
  return { x: Math.round((viewport.w - w) / 2), y, w, maxH, side: 'fixed', floor };
}

/** A pinned card dragged to (x, y): kept inside the viewport, at least `MIN_ROOM` tall. */
export function clampPinned(x: number, y: number, w: number, viewport: Size) {
  const cx = Math.max(EDGE, Math.min(viewport.w - EDGE - w, x));
  const cy = Math.max(EDGE, Math.min(viewport.h - EDGE - MIN_ROOM, y));
  return {
    x: cx,
    y: cy,
    maxH: Math.max(MIN_ROOM, Math.min(CARD_MAX_HEIGHT, viewport.h - EDGE - cy)),
  };
}

/** Whether the selection has scrolled entirely out of the viewport. */
export function isOutOfView(selection: Box, viewport: Size): boolean {
  return (
    selection.bottom <= 0 ||
    selection.top >= viewport.h ||
    selection.right <= 0 ||
    selection.left >= viewport.w
  );
}
