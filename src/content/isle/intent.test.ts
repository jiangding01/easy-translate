import { describe, expect, it } from 'vitest';
import { createIntent } from './intent';

const at = (t: number, x = 100, buttons = 0) => ({ x, y: 100, t, buttons });

describe('hover intent', () => {
  it('opens after the pointer lingers slowly for 120ms', () => {
    const intent = createIntent();
    intent.move(at(0), true);
    intent.move(at(50, 101), true);
    expect(intent.decide(60, false)).toEqual({ wait: 60 });
    expect(intent.decide(120, false)).toEqual({ action: 'open' });
  });

  it('does not open while the pointer is moving fast', () => {
    const intent = createIntent();
    intent.move(at(0, 0), true);
    // 3px/ms: sweeping past the dot.
    for (let t = 10; t <= 100; t += 10) intent.move(at(t, t * 3), true);
    expect(intent.decide(150, false)).toEqual({ wait: 70 });
    expect(intent.decide(219, false).action).toBeUndefined();
    expect(intent.decide(220, false)).toEqual({ action: 'open' });
  });

  it('never opens while a button is held (dragging the scrollbar)', () => {
    const intent = createIntent();
    intent.move(at(0, 100, 1), true);
    intent.move(at(300, 100, 1), true);
    expect(intent.decide(1000, false)).toEqual({});
    intent.move(at(1000, 100, 0), true);
    expect(intent.decide(1000, false).action).toBeUndefined();
    expect(intent.decide(1120, false)).toEqual({ action: 'open' });
  });

  it('waits 200ms after a scroll', () => {
    const intent = createIntent();
    intent.move(at(0), true);
    intent.scroll(100);
    expect(intent.decide(250, false)).toEqual({ wait: 50 });
    expect(intent.decide(300, false)).toEqual({ action: 'open' });
  });

  it('does nothing outside the catch zone', () => {
    const intent = createIntent();
    intent.move(at(0), false);
    expect(intent.decide(1000, false)).toEqual({});
  });

  it('closes 320ms after the pointer leaves the open isle, unless it comes back', () => {
    const intent = createIntent();
    intent.move(at(0), true);
    expect(intent.decide(500, true)).toEqual({});
    intent.move(at(600, 400), false);
    expect(intent.decide(700, true)).toEqual({ wait: 220 });
    intent.move(at(800), true);
    expect(intent.decide(1000, true)).toEqual({});
    intent.move(at(1100, 400), false);
    expect(intent.decide(1420, true)).toEqual({ action: 'close' });
  });

  it('closes when the pointer leaves the window', () => {
    const intent = createIntent();
    intent.move(at(0), true);
    intent.leave(10);
    expect(intent.decide(330, true)).toEqual({ action: 'close' });
  });

  it('holds off reopening right after a close', () => {
    const intent = createIntent();
    intent.move(at(0), true);
    intent.closed(500);
    expect(intent.decide(700, false)).toEqual({ wait: 100 });
    expect(intent.decide(800, false)).toEqual({ action: 'open' });
  });
});
