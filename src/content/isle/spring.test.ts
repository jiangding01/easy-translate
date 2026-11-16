import { describe, expect, it } from 'vitest';
import { createSpring, GROW, LIST, retarget, SHRINK, snap, step } from './spring';

const FRAME = 1 / 60;

/** Runs until rest (or a frame cap); returns frames used and the extreme value seen. */
function run(spring: ReturnType<typeof createSpring>, maxFrames = 600) {
  let frames = 0;
  let max = spring.x;
  let min = spring.x;
  while (frames < maxFrames) {
    frames += 1;
    const rest = step(spring, FRAME);
    max = Math.max(max, spring.x);
    min = Math.min(min, spring.x);
    if (rest) break;
  }
  return { frames, max, min };
}

describe('spring', () => {
  it('settles exactly on the target and then reports rest', () => {
    const spring = createSpring(0);
    retarget(spring, 100, GROW);
    const { frames } = run(spring);
    expect(spring.x).toBe(100);
    expect(spring.v).toBe(0);
    // About 280ms to look settled; the rest threshold is reached well within a second.
    expect(frames).toBeLessThan(60);
    expect(step(spring, FRAME)).toBe(true);
  });

  it('overshoots about 2% when growing and not visibly when shrinking', () => {
    const grow = createSpring(0);
    retarget(grow, 100, GROW);
    const grown = run(grow);
    expect(grown.max).toBeGreaterThan(101);
    expect(grown.max).toBeLessThan(103.5);

    const shrink = createSpring(100);
    retarget(shrink, 0, SHRINK);
    const shrunk = run(shrink);
    expect(shrunk.min).toBeGreaterThan(-0.2);
  });

  it('keeps its velocity when interrupted and turns toward the new target', () => {
    const spring = createSpring(0);
    retarget(spring, 100, GROW);
    for (let i = 0; i < 6; i += 1) step(spring, FRAME);
    const { x, v } = spring;
    expect(v).toBeGreaterThan(0);
    retarget(spring, 0, SHRINK);
    expect(spring.v).toBe(v);
    step(spring, FRAME);
    // Still moving outward for a moment (no jump, no restart from rest).
    expect(spring.x).toBeGreaterThan(x - 1);
    run(spring);
    expect(spring.x).toBe(0);
  });

  it('is stable with a long frame and snaps on demand', () => {
    const spring = createSpring(0);
    retarget(spring, 240, LIST);
    step(spring, 0.5);
    expect(Number.isFinite(spring.x)).toBe(true);
    snap(spring, 10);
    expect(spring).toMatchObject({ x: 10, t: 10, v: 0 });
  });
});
