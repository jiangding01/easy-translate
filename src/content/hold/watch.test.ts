// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHoldWatch, HOLD_MS, type HoldWatch } from './watch';

let watch: HoldWatch | undefined;
let onHold: ReturnType<typeof vi.fn<(point: { x: number; y: number }) => void>>;

/** happy-dom dispatches only untrusted events: tests trust them unless told otherwise. */
function setup(isTrusted: (event: Event) => boolean = () => true) {
  onHold = vi.fn();
  watch = createHoldWatch({ doc: document, onHold, isTrusted });
  watch.start();
  return watch;
}

function move(x: number, y: number, init: PointerEventInit = {}, target: EventTarget = document) {
  target.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX: x,
      clientY: y,
      ctrlKey: true,
      buttons: 0,
      bubbles: true,
      ...init,
    }),
  );
}

function key(type: 'keydown' | 'keyup', name: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, ...init }));
}

const ctrlDown = (init: KeyboardEventInit = {}) => key('keydown', 'Control', init);
const ctrlUp = () => key('keyup', 'Control');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<p>Paragraph</p>';
  setup();
  // The pointer is known and at rest (without Ctrl yet).
  move(100, 200, { ctrlKey: false });
});

afterEach(() => {
  watch?.stop();
  watch = undefined;
  vi.useRealTimers();
  (document.activeElement as HTMLElement | null)?.blur?.();
});

describe('hold watch', () => {
  it('fires once at the pointer after Ctrl is held still, and not again until released', () => {
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(onHold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onHold).toHaveBeenCalledWith({ x: 100, y: 200 });
    vi.advanceTimersByTime(HOLD_MS * 3);
    move(100, 230);
    vi.advanceTimersByTime(HOLD_MS * 3);
    expect(onHold).toHaveBeenCalledTimes(1);
    ctrlUp();
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).toHaveBeenCalledTimes(2);
    expect(onHold).toHaveBeenLastCalledWith({ x: 100, y: 230 });
  });

  it('ignores a quick Ctrl press and release (⌃Space switching the input method)', () => {
    ctrlDown();
    vi.advanceTimersByTime(80);
    ctrlUp();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it.each([
    ['C (Ctrl+C)', 'c'],
    ['Meta', 'Meta'],
    ['Shift', 'Shift'],
    ['Alt', 'Alt'],
  ])('voids the press when another key joins: %s', (_label, other) => {
    ctrlDown();
    vi.advanceTimersByTime(100);
    key('keydown', other, { ctrlKey: true });
    key('keyup', other, { ctrlKey: true });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('voids the press on Ctrl+wheel (zoom)', () => {
    ctrlDown();
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, ctrlKey: true, bubbles: true }));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('does not start while a button is down (Ctrl during a drag)', () => {
    move(110, 200, { ctrlKey: false, buttons: 1 });
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('starts again once the button was released', () => {
    document.dispatchEvent(new PointerEvent('pointerdown', { buttons: 1, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { buttons: 0, bubbles: true }));
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('voids the press on a pointerdown (Ctrl+click on a link)', () => {
    ctrlDown();
    vi.advanceTimersByTime(200);
    document.dispatchEvent(new PointerEvent('pointerdown', { buttons: 1, bubbles: true }));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('voids the press when a move says Ctrl is up (the keyup was lost)', () => {
    ctrlDown();
    vi.advanceTimersByTime(100);
    move(101, 200, { ctrlKey: false });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('does not start the count on a repeated keydown (Ctrl held while coming back)', () => {
    ctrlDown({ repeat: true });
    ctrlDown({ repeat: true });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('needs a new pointer move after the window lost focus', () => {
    window.dispatchEvent(new Event('blur'));
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
    ctrlUp();
    move(100, 200, { ctrlKey: false });
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('voids the press when the window loses focus or the tab is hidden', () => {
    ctrlDown();
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(HOLD_MS * 2);
    move(100, 200);
    ctrlDown();
    vi.advanceTimersByTime(100);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('voids the press when the pointer leaves the document', () => {
    ctrlDown();
    document.body.dispatchEvent(
      new PointerEvent('pointerout', { relatedTarget: null, bubbles: true }),
    );
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('ignores Ctrl during input method composition', () => {
    ctrlDown({ isComposing: true });
    vi.advanceTimersByTime(HOLD_MS * 2);
    ctrlUp();
    ctrlDown({ keyCode: 229 });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('ignores a composition key while Ctrl is held', () => {
    ctrlDown();
    key('keydown', 'Process', { keyCode: 229 });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it.each([
    ['an input without a type', '<input id="f">'],
    ['a text input', '<input id="f" type="text">'],
    ['a search input', '<input id="f" type="search">'],
    ['a password input', '<input id="f" type="password">'],
    ['a number input', '<input id="f" type="number">'],
    ['a textarea', '<textarea id="f"></textarea>'],
    ['an editable element', '<div id="f" contenteditable="true" tabindex="0">x</div>'],
  ])('does not fire while %s has focus', (_label, markup) => {
    document.body.innerHTML = markup;
    (document.getElementById('f') as HTMLElement).focus();
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS * 2);
    ctrlUp();
    expect(onHold).not.toHaveBeenCalled();
  });

  it.each([
    ['a checkbox', '<input id="f" type="checkbox">'],
    ['a radio button', '<input id="f" type="radio">'],
    ['a range slider', '<input id="f" type="range">'],
    ['a submit input', '<input id="f" type="submit">'],
    ['a button', '<button id="f">Go</button>'],
  ])('still fires while %s has focus (no typing there)', (_label, markup) => {
    document.body.innerHTML = markup;
    (document.getElementById('f') as HTMLElement).focus();
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
  ])('voids a Ctrl press that comes with %s already down', (_label, init) => {
    ctrlDown(init);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('ignores synthetic (untrusted) key and pointer events by default', () => {
    watch?.stop();
    // The production default: happy-dom's events are all untrusted.
    setup((event) => event.isTrusted);
    move(100, 200, { ctrlKey: false });
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('a forged keydown starts nothing, a forged move changes nothing', () => {
    watch?.stop();
    const forge = <T extends Event>(event: T) => Object.assign(event, { forged: true });
    setup((event) => !('forged' in event));
    move(100, 200, { ctrlKey: false });
    document.dispatchEvent(forge(new KeyboardEvent('keydown', { key: 'Control' })));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
    ctrlDown();
    // A page script "moving" the pointer away with Ctrl up neither cancels nor moves it.
    document.dispatchEvent(
      forge(new PointerEvent('pointermove', { clientX: 500, clientY: 500, ctrlKey: false })),
    );
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).toHaveBeenCalledWith({ x: 100, y: 200 });
  });

  it('checks the isle when the count ends: the pointer may rest on it by then', () => {
    document.body.innerHTML = '<p>Text</p><et-isle></et-isle>';
    ctrlDown();
    vi.advanceTimersByTime(200);
    // A small move (under 6 px) onto the isle: the count goes on, but must not fire there.
    move(102, 200, {}, document.querySelector('et-isle') as Element);
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('does not fire over the page isle or the selection card', () => {
    document.body.innerHTML = '<et-isle></et-isle><et-selection></et-selection>';
    for (const tag of ['et-isle', 'et-selection']) {
      move(50, 50, {}, document.querySelector(tag) as Element);
      ctrlDown();
      vi.advanceTimersByTime(HOLD_MS * 2);
      ctrlUp();
    }
    expect(onHold).not.toHaveBeenCalled();
  });

  it('does not fire when the pointer has not moved since the page loaded', () => {
    watch?.stop();
    setup();
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('restarts the count when the pointer travels more than 6 px, not for a jitter', () => {
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS - 100);
    // 3 + 3 px: still at rest.
    move(103, 200);
    move(100, 200);
    vi.advanceTimersByTime(100);
    expect(onHold).toHaveBeenCalledTimes(1);
    ctrlUp();
    ctrlDown();
    vi.advanceTimersByTime(300);
    // 4 + 4 px adds up past 6: the count starts again from here.
    move(104, 200);
    move(108, 200);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(onHold).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onHold).toHaveBeenCalledTimes(2);
    expect(onHold).toHaveBeenLastCalledWith({ x: 108, y: 200 });
  });

  it('calls nothing after stop', () => {
    ctrlDown();
    watch?.stop();
    vi.advanceTimersByTime(HOLD_MS * 2);
    ctrlUp();
    move(100, 210);
    ctrlDown();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).not.toHaveBeenCalled();
  });
});
