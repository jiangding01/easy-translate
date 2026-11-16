// Damped springs for the isle's shape (ui-isle-direction section 5, item 2). Plain
// data plus functions: a retarget keeps the current velocity, so an interrupted
// motion turns toward the new target instead of restarting from rest.

export interface SpringParams {
  /** Stiffness. */
  k: number;
  /** Damping. */
  c: number;
}

export interface Spring extends SpringParams {
  /** Current value. */
  x: number;
  /** Velocity, units per second. */
  v: number;
  /** Target. */
  t: number;
}

/** Growth: about 280ms with a ~2% overshoot. */
export const GROW: SpringParams = { k: 380, c: 30 };
/** Shrink: about 200ms, no visible overshoot. */
export const SHRINK: SpringParams = { k: 520, c: 42 };
/** The engine list opening. */
export const LIST: SpringParams = { k: 300, c: 30 };

const SUBSTEPS_PER_SECOND = 240;
const REST_DISTANCE = 0.05;
const REST_VELOCITY = 0.5;

export function createSpring(x: number, params: SpringParams = GROW): Spring {
  return { x, v: 0, t: x, k: params.k, c: params.c };
}

/** Points the spring at a new target; the velocity is kept. */
export function retarget(spring: Spring, target: number, params: SpringParams): void {
  spring.t = target;
  spring.k = params.k;
  spring.c = params.c;
}

/** Jumps to `value` at rest (reduced motion, or a dock switch). */
export function snap(spring: Spring, value: number): void {
  spring.x = value;
  spring.t = value;
  spring.v = 0;
}

export function isResting(spring: Spring): boolean {
  return spring.x === spring.t && spring.v === 0;
}

/**
 * Advances by `dt` seconds (semi-implicit Euler in fixed substeps, stable for any
 * frame time) and returns whether the spring has settled on its target.
 */
export function step(spring: Spring, dt: number): boolean {
  if (isResting(spring)) return true;
  const n = Math.max(1, Math.ceil(dt * SUBSTEPS_PER_SECOND));
  const h = dt / n;
  for (let i = 0; i < n; i += 1) {
    const a = -spring.k * (spring.x - spring.t) - spring.c * spring.v;
    spring.v += a * h;
    spring.x += spring.v * h;
  }
  if (Math.abs(spring.x - spring.t) < REST_DISTANCE && Math.abs(spring.v) < REST_VELOCITY) {
    snap(spring, spring.t);
    return true;
  }
  return false;
}
