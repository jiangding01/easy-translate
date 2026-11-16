// Hover intent (ui-isle-direction section 2, item 1): the dot opens only when the
// pointer lingers on it slowly, never while a button is held (dragging the
// scrollbar) or right after a scroll; the open isle closes shortly after the
// pointer leaves. Pure: the caller passes time and whether the pointer is inside.

export interface PointerSample {
  x: number;
  y: number;
  /** Milliseconds, same clock as every other call. */
  t: number;
  /** `PointerEvent.buttons`: non-zero while pressed. */
  buttons: number;
}

export interface IntentOptions {
  /** Time the pointer must stay slow inside the catch zone. */
  dwellMs: number;
  /** Speed (px/ms) under which the pointer counts as lingering. */
  maxSpeed: number;
  /** No opening within this long after a scroll. */
  scrollQuietMs: number;
  /** The open isle closes this long after the pointer left it. */
  leaveMs: number;
  /** After a close, the dot does not reopen for this long. */
  reopenMs: number;
}

export const INTENT_DEFAULTS: IntentOptions = {
  dwellMs: 120,
  maxSpeed: 0.3,
  scrollQuietMs: 200,
  leaveMs: 320,
  reopenMs: 300,
};

export type IntentAction = 'open' | 'close';

export interface IntentDecision {
  action?: IntentAction;
  /** Ask again after this many ms (the decision may change with no new event). */
  wait?: number;
}

export interface Intent {
  /** A pointer sample; `inside` is the catch zone when closed, the shape when open. */
  move(sample: PointerSample, inside: boolean): void;
  /** The pointer left the window. */
  leave(t: number): void;
  scroll(t: number): void;
  /** Just closed (by any means): hold off reopening for a moment. */
  closed(t: number): void;
  decide(t: number, open: boolean): IntentDecision;
}

export function createIntent(overrides: Partial<IntentOptions> = {}): Intent {
  const options = { ...INTENT_DEFAULTS, ...overrides };
  let inside = false;
  let down = false;
  let speed = 0;
  let last: PointerSample | undefined;
  /** Since when the pointer has been inside and slow. */
  let slowSince = Number.POSITIVE_INFINITY;
  let leftAt = Number.NEGATIVE_INFINITY;
  let lastScroll = Number.NEGATIVE_INFINITY;
  let quietUntil = Number.NEGATIVE_INFINITY;

  return {
    move(sample, nowInside) {
      const wasDown = down;
      down = sample.buttons !== 0;
      if (last && inside) {
        const dt = Math.max(1, sample.t - last.t);
        const instant = Math.hypot(sample.x - last.x, sample.y - last.y) / dt;
        speed = speed * 0.5 + instant * 0.5;
      } else {
        speed = 0;
      }
      if (nowInside && !inside) slowSince = sample.t;
      // Releasing a button (end of a scrollbar drag) restarts the dwell too.
      else if (nowInside && (speed > options.maxSpeed || down || wasDown)) slowSince = sample.t;
      if (!nowInside && inside) leftAt = sample.t;
      inside = nowInside;
      last = sample;
    },
    leave(t) {
      if (inside) leftAt = t;
      inside = false;
      last = undefined;
    },
    scroll(t) {
      lastScroll = t;
      if (inside) slowSince = t;
    },
    closed(t) {
      quietUntil = t + options.reopenMs;
      if (inside) slowSince = t;
    },
    decide(t, open) {
      if (open) {
        if (inside) return {};
        const due = leftAt + options.leaveMs;
        return t >= due ? { action: 'close' } : { wait: due - t };
      }
      if (!inside || down) return {};
      const due = Math.max(
        slowSince + options.dwellMs,
        lastScroll + options.scrollQuietMs,
        quietUntil,
      );
      return t >= due ? { action: 'open' } : { wait: due - t };
    },
  };
}
