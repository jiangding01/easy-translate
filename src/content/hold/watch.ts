import { deepActiveElement, isOwnNode } from '../selection/watch';

// The always-loaded half of hold-to-toggle (M3b plan, section 4): holding Ctrl with the
// pointer at rest asks for the paragraph under it to be toggled. Only the pointer position
// and the key state are kept here; nothing reads the page or loads anything. The whole
// trigger rule lives in this file so it can be replaced on its own.

/** How long Ctrl must be held with the pointer at rest. */
export const HOLD_MS = 400;
/** Pointer travel (summed) while held that restarts the count. */
export const STILL_PX = 6;

const TEXT_INPUT = /^(text|search|email|url|tel|password|number)$/;

/**
 * Focus where Ctrl starts a text shortcut (Ctrl+A, Ctrl+←): a text field or editable
 * content. A focused checkbox, slider or button takes no typing, so it does not count.
 */
function isTypingFocus(doc: Document): boolean {
  const active = deepActiveElement(doc);
  if (active?.nodeName === 'INPUT') return TEXT_INPUT.test((active as HTMLInputElement).type);
  return (
    active?.nodeName === 'TEXTAREA' || (active as HTMLElement | null)?.isContentEditable === true
  );
}

export interface HoldWatchDeps {
  doc: Document;
  /** Ctrl was held still at this viewport point; called once per press. */
  onHold(point: { x: number; y: number }): void;
  /**
   * Whether an event came from the user; page scripts can forge the rest. Defaults to
   * `event.isTrusted` (test DOMs dispatch only untrusted events).
   */
  isTrusted?(event: Event): boolean;
}

export interface HoldWatch {
  start(): void;
  stop(): void;
}

export function createHoldWatch({
  doc,
  onHold,
  isTrusted = (event) => event.isTrusted,
}: HoldWatchDeps): HoldWatch {
  const win = doc.defaultView;
  /** The last pointer position; unknown until the pointer moves (again, after a blur). */
  let point: { x: number; y: number } | undefined;
  /** The last pointer event's buttons: key events carry none. */
  let buttons = 0;
  /** What the pointer last moved over; looked at only when it matters. */
  let over: EventTarget | null = null;
  /** `done`: fired or voided; nothing more until Ctrl is released. */
  let press: 'up' | 'timing' | 'done' = 'up';
  let moved = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const end = (next: typeof press) => {
    clearTimeout(timer);
    timer = undefined;
    press = next;
  };
  const voidPress = () => {
    if (press === 'timing') end('done');
  };
  /** Over the isle or the selection card, or typing somewhere: not a paragraph toggle. */
  const busy = () => isOwnNode(over as Node | null) || isTypingFocus(doc);
  const count = () => {
    clearTimeout(timer);
    moved = 0;
    timer = setTimeout(() => {
      end('done');
      if (point && !busy()) onHold(point);
    }, HOLD_MS);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isTrusted(event)) return;
    if (event.key !== 'Control') return voidPress();
    // A repeat is Ctrl held from before (Ctrl+Tab back to this tab): not a new press.
    if (press !== 'up' || event.repeat) return;
    if (
      !point ||
      buttons !== 0 ||
      // Ctrl joining other modifiers (⌃⌘Space, ⌃⇧⌘4, Shift then Ctrl+Tab): a shortcut.
      event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      event.keyCode === 229 ||
      busy()
    ) {
      press = 'done';
      return;
    }
    press = 'timing';
    count();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Control') end('up');
  };
  const onMove = (event: PointerEvent) => {
    if (!isTrusted(event)) return;
    buttons = event.buttons;
    over = event.target;
    if (point) moved += Math.hypot(event.clientX - point.x, event.clientY - point.y);
    point = { x: event.clientX, y: event.clientY };
    // Ctrl is not down after all: its keyup was lost.
    if (!event.ctrlKey) end('up');
    else if (press === 'timing' && moved > STILL_PX) count();
  };
  const onDown = (event: PointerEvent) => {
    buttons = event.buttons;
    voidPress();
  };
  const onUp = (event: PointerEvent) => {
    buttons = event.buttons;
  };
  const onOut = (event: PointerEvent) => {
    if (event.relatedTarget) return;
    point = undefined;
    voidPress();
  };
  /** Focus or the tab went away: keys may be lost, and the pointer may be anywhere now. */
  const onLost = () => {
    point = undefined;
    end('up');
  };

  const listen = { capture: true, passive: true } as const;
  const docEvents = [
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['pointermove', onMove],
    ['pointerdown', onDown],
    ['pointerup', onUp],
    ['pointerout', onOut],
    ['wheel', voidPress],
    ['visibilitychange', onLost],
  ] as [string, EventListener][];
  return {
    start() {
      if (running) return;
      running = true;
      for (const [type, listener] of docEvents) doc.addEventListener(type, listener, listen);
      win?.addEventListener('blur', onLost, listen);
    },
    stop() {
      if (!running) return;
      running = false;
      for (const [type, listener] of docEvents) doc.removeEventListener(type, listener, listen);
      win?.removeEventListener('blur', onLost, listen);
      point = undefined;
      end('up');
    },
  };
}
