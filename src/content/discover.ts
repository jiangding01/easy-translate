import { isInlineElement, isSkipped, type StyleReader } from './dom-rules';
import { type Segment, segment } from './segment';
import { isTranslatableText } from './text';

// Finds translation units: leaf blocks (no block descendants) and inline runs
// inside mixed blocks. Post-order with an explicit stack (no recursion limits)
// and time slices, so huge pages never block the main thread.

export interface Unit {
  kind: 'block' | 'run';
  /** The block itself, or the parent of a run. */
  root: Element;
  /** The unit's content: all children of a block, or a run's contiguous siblings. */
  nodes: Node[];
  seg: Segment;
}

export interface DiscoverOptions {
  readStyle: StyleReader;
  /** Called every few elements; resolves after yielding the main thread when the slice is used up. */
  pace?: () => Promise<void> | undefined;
  /** Stops early (session ended). */
  cancelled?: () => boolean;
}

const MAX_DEPTH = 512;
const PACE_EVERY = 64;

/** Slicer: yields when more than `sliceMs` passed since the last yield. */
export function createPacer(
  sliceMs = 8,
  now: () => number = () => performance.now(),
  yieldNow: () => Promise<void> = defaultYield,
): () => Promise<void> | undefined {
  let started = now();
  return () => {
    if (now() - started < sliceMs) return undefined;
    return yieldNow().then(() => {
      started = now();
    });
  };
}

function defaultYield(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeUnit(kind: Unit['kind'], root: Element, nodes: Node[]): Unit | undefined {
  if (nodes.length === 0) return undefined;
  const seg = segment(nodes);
  if (!isTranslatableText(seg.plain)) return undefined;
  return { kind, root, nodes, seg };
}

export async function discoverUnits(root: Element, options: DiscoverOptions): Promise<Unit[]> {
  const { readStyle } = options;
  const units: Unit[] = [];
  const blockish = new WeakMap<Element, boolean>();
  const inline = (el: Element) => isInlineElement(el, readStyle);
  type Frame = { el: Element; depth: number; exiting: boolean };
  const stack: Frame[] = [{ el: root, depth: 0, exiting: false }];
  let steps = 0;

  while (stack.length > 0) {
    if (options.cancelled?.()) return units;
    steps += 1;
    if (steps % PACE_EVERY === 0) {
      const wait = options.pace?.();
      if (wait) await wait;
    }
    const frame = stack.pop() as Frame;
    const { el } = frame;
    if (!frame.exiting) {
      if (frame.depth > MAX_DEPTH) {
        // A boundary: neither scanned nor pulled into an ancestor's unit.
        blockish.set(el, true);
        continue;
      }
      if (el !== root && isSkipped(el)) continue;
      stack.push({ ...frame, exiting: true });
      const children = el.children;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) stack.push({ el: child, depth: frame.depth + 1, exiting: false });
      }
      continue;
    }

    let childBlockish = false;
    for (const child of el.children) {
      if (blockish.get(child)) {
        childBlockish = true;
        break;
      }
    }
    const isBlockish = el === root || !inline(el) || childBlockish;
    blockish.set(el, isBlockish);
    if (!isBlockish) continue;

    if (!childBlockish) {
      const unit = makeUnit('block', el, [...el.childNodes]);
      if (unit) units.push(unit);
      continue;
    }
    // Mixed block: runs of text and inline children, split by block children.
    let run: Node[] = [];
    const flush = () => {
      const unit = makeUnit('run', el, run);
      if (unit) units.push(unit);
      run = [];
    };
    for (const child of el.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as Element;
        if (blockish.get(childEl) || (isSkipped(childEl) && !inline(childEl))) {
          flush();
          continue;
        }
      }
      run.push(child);
    }
    flush();
  }
  return units;
}
