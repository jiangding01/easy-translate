// Watches the page for new or changed content while a session runs. Only
// childList and characterData: attributes are not observed (cheap on big pages).
// Our own additions are filtered out; bursts are coalesced and cooled down.

export interface MutationWatchOptions {
  root: Element;
  isOwn: (node: Node) => boolean;
  /** Removed nodes that never count as a page change (our loading dots, translations we detached). */
  ignoreRemoved?: (node: Node) => boolean;
  /** Called with the coalesced dirty elements (or [root] after a burst). */
  onDirty: (elements: Element[]) => void;
  debounceMs?: number;
  /** More dirty elements than this collapse into one whole-root rescan. */
  burstLimit?: number;
  createObserver?: (callback: MutationCallback) => Pick<MutationObserver, 'observe' | 'disconnect'>;
  now?: () => number;
  /**
   * Identifies the page's current route. A whole-root rescan that finds a different key than
   * the last one drops the raised cooldown back to the lowest level: moving between routes
   * is not the endless churn the cooldown guards against.
   */
  routeKey?: () => string;
}

/** `pathname + search`; the hash only when it is a route (`#/` or `#!`), not an anchor. */
export function routeKeyOf(loc: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  return loc.pathname + loc.search + (/^#[/!]/.test(loc.hash) ? loc.hash : '');
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
  let lastRoute = options.routeKey?.();

  const relevant = (nodes: NodeList) => [...nodes].some((node) => !isOwn(node));
  const removedRelevant = (nodes: NodeList) => [...nodes].some((node) => !ignoreRemoved(node));

  const fire = () => {
    timer = undefined;
    if (dirty.size === 0) return;
    if (dirty.size > burstLimit) {
      const at = now();
      if (at - lastBroad > QUIET_RESET_MS) broadLevel = 0;
      const route = options.routeKey?.();
      if (route !== lastRoute) {
        lastRoute = route;
        broadLevel = 0;
      }
      const cooldown = COOLDOWNS[Math.min(broadLevel, COOLDOWNS.length - 1)] ?? 4000;
      if (at - lastBroad < cooldown) {
        // In steps, so a route change during the wait is noticed on the next one.
        timer = setTimeout(fire, Math.min(debounceMs, cooldown - (at - lastBroad)));
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
        // says is a removal of its own making (a loading dot swapped for the translation,
        // a translation it detached itself).
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
