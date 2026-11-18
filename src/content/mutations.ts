// Watches the page for new or changed content while a session runs. Only
// childList and characterData: attributes are not observed (cheap on big pages).
// Our own additions are filtered out; bursts are coalesced and cooled down.

export interface MutationWatchOptions {
  root: Element;
  isOwn: (node: Node) => boolean;
  /** Removed nodes that never count as a page change (our loading dots going away). */
  ignoreRemoved?: (node: Node) => boolean;
  /** Called with the coalesced dirty elements (or [root] after a burst). */
  onDirty: (elements: Element[]) => void;
  debounceMs?: number;
  /** More dirty elements than this collapse into one whole-root rescan. */
  burstLimit?: number;
  createObserver?: (callback: MutationCallback) => Pick<MutationObserver, 'observe' | 'disconnect'>;
  now?: () => number;
}

const COOLDOWNS = [1000, 2000, 4000];
const QUIET_RESET_MS = 10_000;

export function watchMutations(options: MutationWatchOptions): () => void {
  const { root, isOwn, onDirty } = options;
  const ignoreRemoved = options.ignoreRemoved ?? (() => false);
  const debounceMs = options.debounceMs ?? 300;
  const burstLimit = options.burstLimit ?? 32;
  const now = options.now ?? (() => Date.now());
  const dirty = new Set<Element>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let broadLevel = 0;
  let lastBroad = Number.NEGATIVE_INFINITY;

  const relevant = (nodes: NodeList) => [...nodes].some((node) => !isOwn(node));
  const removedRelevant = (nodes: NodeList) => [...nodes].some((node) => !ignoreRemoved(node));

  const fire = () => {
    timer = undefined;
    if (dirty.size === 0) return;
    if (dirty.size > burstLimit) {
      const at = now();
      if (at - lastBroad > QUIET_RESET_MS) broadLevel = 0;
      const cooldown = COOLDOWNS[Math.min(broadLevel, COOLDOWNS.length - 1)] ?? 4000;
      if (at - lastBroad < cooldown) {
        timer = setTimeout(fire, cooldown - (at - lastBroad));
        return;
      }
      lastBroad = at;
      broadLevel += 1;
      dirty.clear();
      onDirty([root]);
      return;
    }
    const elements = [...dirty];
    dirty.clear();
    // Drop elements contained in another dirty element: one rescan covers both.
    onDirty(elements.filter((el) => !elements.some((other) => other !== el && other.contains(el))));
  };

  const create =
    options.createObserver ?? ((callback: MutationCallback) => new MutationObserver(callback));
  const observer = create((records) => {
    for (const record of records) {
      const target = record.target;
      if (isOwn(target)) continue;
      if (record.type === 'childList') {
        // Any removal counts, ours included: a framework dropping only our <et-tr>
        // is how we notice a translation that needs to come back. Except what the caller
        // says is a removal of its own making (a loading dot swapped for the translation).
        if (!relevant(record.addedNodes) && !removedRelevant(record.removedNodes)) continue;
        if (target.nodeType === Node.ELEMENT_NODE) dirty.add(target as Element);
      } else if (record.type === 'characterData') {
        const parent = target.parentElement;
        if (parent && !isOwn(parent)) dirty.add(parent);
      }
    }
    if (dirty.size > 0 && timer === undefined) timer = setTimeout(fire, debounceMs);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    dirty.clear();
  };
}
