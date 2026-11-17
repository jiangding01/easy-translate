import { describe, expect, it } from 'vitest';
import {
  CARD_MAX_HEIGHT,
  CARD_WIDTH,
  cardTop,
  clampDot,
  clampPinned,
  DOT_OFFSET,
  dotAt,
  EDGE,
  GAP,
  isOutOfView,
  MIN_ROOM,
  placeCard,
  placeDetached,
} from './place';

const VIEW = { w: 1280, h: 800 };
const line = (top: number, bottom = top + 24) => ({ left: 200, top, right: 600, bottom });
const pt = (x: number, y: number) => ({ x, y });

describe('dotAt: the dot at the bottom right of the last character', () => {
  it('sits on the bottom edge of the last line, just right of the last character', () => {
    // A three-line paragraph whose last line ends at x = 520 and has its bottom at 262.
    const dot = dotAt({ x: 520, y: 262 }, VIEW);
    expect(dot).toEqual({ x: 520 + DOT_OFFSET, y: 262 });
    // Its 10px disc starts 1-3px right of the last character: clear of a closing
    // punctuation mark, but not floating off into the blank space.
    expect(dot.x - 5 - 520).toBeGreaterThanOrEqual(1);
    expect(dot.x - 5 - 520).toBeLessThanOrEqual(3);
  });

  // nudgeDot (and its five tests) is gone on purpose: moving the dot 20px off the release
  // point pushed it far into the blank space when a drag ended right of the line's end.
  // The dot stays put now; a hand resting on it is handled by the hover rule instead
  // (card.test.ts, "dot"), which only opens for a pointer that came in from outside.

  it('keeps the dot inside the viewport', () => {
    expect(clampDot({ x: -5, y: 900 }, VIEW)).toEqual({ x: 12, y: 790 });
    expect(dotAt({ x: 1279, y: 799 }, VIEW)).toEqual({ x: 1268, y: 790 });
  });
});

describe('placeCard (plan 4.3 rule 5)', () => {
  it('goes below the selection when it fits, its top edge on the last line’s bottom', () => {
    const place = placeCard(line(100), pt(600, 124), 200, VIEW);
    expect(place).toMatchObject({ side: 'below', y: 124, w: CARD_WIDTH });
    expect(place.maxH).toBe(CARD_MAX_HEIGHT);
    expect(cardTop(line(100), pt(600, 124), place, 300, VIEW)).toBe(124);
  });

  it('goes above when only that side fits; its bottom edge stays put as it grows', () => {
    const selection = line(700);
    const dot = pt(600, 724);
    const place = placeCard(selection, dot, 200, VIEW);
    expect(place.side).toBe('above');
    expect(place.y + 200).toBe(700 - GAP);
    expect(cardTop(selection, dot, place, 260, VIEW)).toBe(700 - GAP - 260);
  });

  it('picks the roomier side with the height limited when neither fits', () => {
    // 306px above, 158px below: neither holds 380.
    const place = placeCard(
      { left: 200, top: 316, right: 600, bottom: 634 },
      pt(600, 634),
      380,
      VIEW,
    );
    expect(place.side).toBe('above');
    expect(place.maxH).toBe(316 - GAP - EDGE);
    const lower = placeCard(
      { left: 200, top: 180, right: 600, bottom: 500 },
      pt(600, 500),
      380,
      VIEW,
    );
    expect(lower).toMatchObject({ side: 'below', maxH: 800 - EDGE - 500 });
  });

  it('avoids the whole selection, not only its last line', () => {
    // Three lines: the card goes under the last, never over the first two.
    const selection = { left: 100, top: 200, right: 700, bottom: 272 };
    const place = placeCard(selection, pt(300, 272), 150, VIEW);
    expect(place.y).toBeGreaterThanOrEqual(272);
    // A last line that is not the lowest (a taller glyph earlier on it): still clear.
    const taller = placeCard(selection, pt(300, 266), 150, VIEW);
    expect(taller.y).toBe(272);
    expect(cardTop(selection, pt(300, 266), taller, 200, VIEW)).toBe(272);
  });

  it('overlaps only when neither side has the minimum room', () => {
    const place = placeCard({ left: 0, top: 60, right: 600, bottom: 760 }, pt(600, 760), 300, VIEW);
    expect(place.side).toBe('over');
    expect(place.y + 300).toBe(800 - EDGE);
    expect(MIN_ROOM).toBeGreaterThan(60);
  });

  it('never exceeds 380px', () => {
    expect(placeCard(line(10), pt(600, 34), 2000, VIEW).maxH).toBe(CARD_MAX_HEIGHT);
  });

  it('clamps horizontally 8px inside the viewport', () => {
    expect(placeCard(line(100), pt(1275, 124), 200, VIEW).x).toBe(1280 - EDGE - CARD_WIDTH);
    expect(placeCard(line(100), pt(5, 124), 200, VIEW).x).toBe(EDGE);
    // Narrower than the card: as wide as the viewport allows.
    const narrow = placeCard(line(100), pt(100, 124), 200, { w: 320, h: 600 });
    expect(narrow).toMatchObject({ x: EDGE, w: 320 - 2 * EDGE });
  });
});

describe('placeCard: a top corner on the dot', () => {
  /** How far the card's top corner on `corner`'s side is from `dot`. */
  const miss = (
    place: { x: number; y: number; w: number },
    dot: { x: number; y: number },
    corner: 'left' | 'right',
  ) => Math.hypot((corner === 'left' ? place.x : place.x + place.w) - dot.x, place.y - dot.y);

  it('no room on the right: the top right corner is the dot', () => {
    // A three-line selection whose last line ends at x = 1000, bottom 293.
    const selection = { left: 100, top: 200, right: 1100, bottom: 293 };
    const dot = dotAt({ x: 1000, y: 293 }, VIEW);
    const place = placeCard(selection, dot, 200, VIEW);
    expect(miss(place, dot, 'right')).toBeLessThanOrEqual(1);
  });

  it('room on the right: the top left corner is the dot, even in the right half', () => {
    // The middle and a dot at 900 (360 more still ends at 1260, inside 1272) grow right.
    for (const x of [640, 900]) {
      const dot = pt(x, 124);
      expect(miss(placeCard(line(100), dot, 200, VIEW), dot, 'left')).toBeLessThanOrEqual(1);
    }
    // One pixel too far: the card flips to the left.
    const edge = pt(1280 - EDGE - CARD_WIDTH + 1, 124);
    expect(miss(placeCard(line(100), edge, 200, VIEW), edge, 'right')).toBeLessThanOrEqual(1);
  });

  it('left half: the top left corner is the dot', () => {
    const selection = { left: 100, top: 200, right: 900, bottom: 293 };
    const dot = dotAt({ x: 300, y: 293 }, VIEW);
    const place = placeCard(selection, dot, 200, VIEW);
    expect(miss(place, dot, 'left')).toBeLessThanOrEqual(1);
    expect(
      miss(placeCard(line(100), pt(12, 124), 200, VIEW), pt(12, 124), 'left'),
    ).toBeLessThanOrEqual(1);
  });

  it('near the right edge it is clamped 8px inside, the top edge still on the dot', () => {
    const place = placeCard(line(100), pt(1278, 124), 200, VIEW);
    expect(place.x).toBe(1280 - EDGE - CARD_WIDTH);
    expect(place.y).toBe(124);
    // Left half of a narrow viewport: the left edge rule would push it past the right edge.
    expect(placeCard(line(100), pt(200, 124), 200, { w: 500, h: 800 }).x).toBe(
      500 - EDGE - CARD_WIDTH,
    );
    expect(placeCard(line(100), pt(300, 124), 200, { w: 500, h: 800 }).x).toBe(EDGE);
  });

  it('no room below: flipped above the first line, same side, never over the selection', () => {
    const selection = { left: 100, top: 676, right: 1100, bottom: 748 };
    const dot = dotAt({ x: 1100, y: 748 }, VIEW);
    const place = placeCard(selection, dot, 200, VIEW);
    expect(place.side).toBe('above');
    // The bottom right corner sits on the first line's top, on the dot's side.
    expect(place.x + place.w).toBe(dot.x);
    expect(place.y + 200).toBe(676 - GAP);
    for (const h of [120, 200, place.maxH]) {
      const top = cardTop(selection, dot, place, h, VIEW);
      expect(top + h).toBeLessThanOrEqual(selection.top);
    }
    const left = placeCard(
      { left: 100, top: 676, right: 400, bottom: 748 },
      pt(300, 748),
      200,
      VIEW,
    );
    expect(left).toMatchObject({ side: 'above', x: 300 });
    expect(left.y + 200).toBeLessThanOrEqual(676);
  });
});

describe('placeCard: right first, then left', () => {
  const right = { left: 1224, top: 60, right: 1264, bottom: 260 };

  it('room on the right is used first; otherwise the left', () => {
    expect(placeCard(line(100), pt(800, 124), 200, VIEW).x).toBe(800);
    expect(placeCard(line(100), pt(1000, 124), 200, VIEW).x).toBe(1000 - CARD_WIDTH);
  });

  it('a side isle on the right of the dot sends the card left when that is clear', () => {
    // Right of 900 spans [900, 1260]: over the isle at [1224, 1264]. Left spans [540, 900].
    const place = placeCard(line(100), pt(900, 124), 200, VIEW, right);
    expect(place.x).toBe(900 - CARD_WIDTH);
    expect(placeCard(line(100), pt(900, 124), 200, VIEW).x).toBe(900);
  });

  it('a side isle on the left of the dot keeps the card on the right', () => {
    const left = { left: 16, top: 60, right: 56, bottom: 260 };
    expect(placeCard(line(100), pt(300, 124), 200, VIEW, left).x).toBe(300);
  });

  it('neither side fits: clamped by the half the dot is in, as before', () => {
    const narrow = { w: 500, h: 800 };
    expect(placeCard(line(100), pt(200, 124), 200, narrow).x).toBe(500 - EDGE - CARD_WIDTH);
    expect(placeCard(line(100), pt(300, 124), 200, narrow).x).toBe(EDGE);
    // Both sides crowd the isle: the old push still applies.
    const dockRight = { left: 460, top: 60, right: 490, bottom: 260 };
    const both = placeCard(line(100), pt(250, 124), 200, narrow, dockRight);
    expect(both.x + both.w).toBe(460 - EDGE);
  });

  it('flipped above, the same left/right rule holds', () => {
    const selection = line(700);
    const grow = placeCard(selection, pt(800, 724), 200, VIEW);
    expect(grow).toMatchObject({ side: 'above', x: 800 });
    const back = placeCard(selection, pt(1100, 724), 200, VIEW);
    expect(back).toMatchObject({ side: 'above', x: 1100 - CARD_WIDTH });
    // Above, growing up from 698 to as far as 318, the isle at [400, 600] is in reach; right over it, left clear.
    const isle = { left: 1224, top: 400, right: 1264, bottom: 600 };
    const dodged = placeCard(selection, pt(900, 724), 200, VIEW, isle);
    expect(dodged).toMatchObject({ side: 'above', x: 900 - CARD_WIDTH });
  });
});

describe('placeCard: keeps clear of the isle', () => {
  const right = { left: 1224, top: 300, right: 1264, bottom: 500 };
  const left = { left: 16, top: 300, right: 56, bottom: 500 };
  const bottom = { left: 500, top: 744, right: 780, bottom: 784 };

  it('right dock: the right edge stays 8px left of the isle', () => {
    const place = placeCard(line(100), pt(1250, 124), 200, VIEW, right);
    expect(place.x + place.w).toBe(1224 - EDGE);
    // A card already clear of it is not moved.
    expect(placeCard(line(100), pt(300, 124), 200, VIEW, right).x).toBe(300);
  });

  it('left dock: the left edge stays 8px right of the isle', () => {
    expect(placeCard(line(100), pt(30, 124), 200, VIEW, left).x).toBe(56 + EDGE);
    expect(placeCard(line(100), pt(1000, 124), 200, VIEW, left).x + CARD_WIDTH).toBe(1000);
  });

  it('bottom dock: the bottom edge stays 8px above the isle, flipping above sooner', () => {
    // 212px between the selection and the isle: a 200px card still fits below.
    const fits = placeCard(line(500), pt(600, 524), 200, VIEW, bottom);
    expect(fits).toMatchObject({ side: 'below', maxH: 744 - EDGE - 524 });
    // Without the isle it would fit below; with it, it goes above.
    expect(placeCard(line(560), pt(600, 584), 200, VIEW).side).toBe('below');
    expect(placeCard(line(560), pt(600, 584), 200, VIEW, bottom).side).toBe('above');
    // Overlapping the selection, it rests on the isle's top, not the viewport's bottom.
    const tall = { left: 0, top: 60, right: 600, bottom: 700 };
    const over = placeCard(tall, pt(600, 700), 300, VIEW, bottom);
    expect(over.side).toBe('over');
    expect(over.y + 300).toBe(744 - EDGE);
    expect(cardTop(line(0), pt(600, 24), over, 320, VIEW)).toBe(744 - EDGE - 320);
  });

  it('bottom dock: a card horizontally clear of the isle ignores it', () => {
    // Left half: the card spans [100, 460], the isle [500, 780].
    const clear = placeCard(line(560), pt(100, 584), 200, VIEW, bottom);
    expect(clear.x + clear.w).toBeLessThan(bottom.left);
    expect(clear).toMatchObject({ side: 'below', floor: VIEW.h - EDGE });
    expect(clear).toEqual(placeCard(line(560), pt(100, 584), 200, VIEW));
  });

  it('side docks: a card vertically clear of the isle (over its whole height) ignores it', () => {
    const high = { left: 1224, top: 40, right: 1264, bottom: 240 };
    // Below line(600): at most [624, 792]; the isle is [300, 500].
    const below = placeCard(line(600), pt(1250, 624), 150, VIEW, right);
    expect(below.side).toBe('below');
    expect(below).toEqual(placeCard(line(600), pt(1250, 624), 150, VIEW));
    // Above line(700), growing up to 380px: [318, 698]; the isle is [40, 240].
    const above = placeCard(line(700), pt(1250, 724), 200, VIEW, high);
    expect(above.side).toBe('above');
    expect(above.x).toBe(1250 - CARD_WIDTH);
    // Same card, but it may grow into an isle at [300, 500]: it keeps clear.
    expect(placeCard(line(700), pt(1250, 724), 200, VIEW, right).x + CARD_WIDTH).toBe(1224 - EDGE);
    const leftHigh = { left: 16, top: 40, right: 56, bottom: 240 };
    expect(placeCard(line(700), pt(30, 724), 200, VIEW, leftHigh).x).toBe(30);
    expect(placeCard(line(700), pt(30, 724), 200, VIEW, left).x).toBe(56 + EDGE);
  });

  it('no isle: no avoidance', () => {
    expect(placeCard(line(100), pt(1250, 124), 200, VIEW, undefined)).toEqual(
      placeCard(line(100), pt(1250, 124), 200, VIEW),
    );
    expect(placeCard(line(100), pt(1250, 124), 200, VIEW).x).toBe(1250 - CARD_WIDTH);
  });
});

describe('placeDetached and pinning', () => {
  it('centers a card with no selection on the upper third line, top edge fixed', () => {
    const place = placeDetached(200, VIEW);
    expect(place).toMatchObject({ x: (1280 - CARD_WIDTH) / 2, side: 'fixed' });
    expect(place.y + 100).toBe(Math.round(800 / 3));
    expect(cardTop(line(0), pt(0, 24), place, 300, VIEW)).toBe(place.y);
  });

  it('keeps a dragged card inside the viewport with room for its content', () => {
    expect(clampPinned(-50, -50, CARD_WIDTH, VIEW)).toMatchObject({ x: EDGE, y: EDGE });
    const low = clampPinned(2000, 2000, CARD_WIDTH, VIEW);
    expect(low).toEqual({ x: 1280 - EDGE - CARD_WIDTH, y: 800 - EDGE - MIN_ROOM, maxH: MIN_ROOM });
    expect(clampPinned(100, 100, CARD_WIDTH, VIEW).maxH).toBe(CARD_MAX_HEIGHT);
  });

  it('knows when the selection left the viewport', () => {
    expect(isOutOfView(line(-40, -2), VIEW)).toBe(true);
    expect(isOutOfView(line(800), VIEW)).toBe(true);
    expect(isOutOfView(line(-10, 5), VIEW)).toBe(false);
  });
});
