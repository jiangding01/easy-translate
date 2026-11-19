// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeKeyOf, watchMutations } from './mutations';

const isOwn = (node: Node) => {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (current.nodeName === 'ET-TR') return true;
  }
  return false;
};

let stop: (() => void) | undefined;
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function watch(
  options: {
    burstLimit?: number;
    now?: () => number;
    ignoreRemoved?: (node: Node) => boolean;
  } = {},
) {
  const onDirty = vi.fn<(elements: Element[]) => void>();
  stop = watchMutations({ root: document.body, isOwn, onDirty, debounceMs: 5, ...options });
  return onDirty;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="a"><p id="p">Text</p></div><div id="b"></div>';
});

afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('watchMutations', () => {
  it('ignores our own additions and edits inside our nodes', async () => {
    const onDirty = watch();
    const tr = document.createElement('et-tr');
    document.getElementById('p')?.append(tr);
    tr.textContent = '译文';
    await wait();
    expect(onDirty).not.toHaveBeenCalled();
  });

  it('reports removal of our node so a lost translation can come back', async () => {
    const tr = document.createElement('et-tr');
    document.getElementById('p')?.append(tr);
    const onDirty = watch();
    tr.remove();
    await vi.waitFor(() => expect(onDirty).toHaveBeenCalledTimes(1));
    expect(onDirty.mock.calls[0]?.[0].map((el) => el.id)).toEqual(['p']);
  });

  it('does not count removals the caller marks as its own, but still counts the rest', async () => {
    const dot = document.createElement('et-tr');
    dot.setAttribute('data-et-state', 'loading');
    const other = document.createElement('span');
    document.getElementById('p')?.append(dot, other);
    const onDirty = watch({ ignoreRemoved: (node) => node === dot });
    dot.remove();
    await wait();
    expect(onDirty).not.toHaveBeenCalled();
    other.remove();
    await vi.waitFor(() => expect(onDirty).toHaveBeenCalledTimes(1));
  });

  it('coalesces nested changes into the outermost element', async () => {
    const onDirty = watch();
    const a = document.getElementById('a') as HTMLElement;
    a.append(document.createElement('span'));
    (document.getElementById('p')?.firstChild as Text).nodeValue = 'Changed';
    document.getElementById('b')?.append(document.createElement('i'));
    await vi.waitFor(() => expect(onDirty).toHaveBeenCalledTimes(1));
    expect(onDirty.mock.calls[0]?.[0].map((el) => el.id).sort()).toEqual(['a', 'b']);
  });

  it('collapses a burst into one whole-root rescan and cools down the next one', async () => {
    let clock = 0;
    const onDirty = watch({ burstLimit: 2, now: () => clock });
    const burst = () => {
      for (let i = 0; i < 4; i += 1) {
        const holder = document.createElement('section');
        document.body.append(holder);
        holder.append(document.createElement('p'));
      }
    };
    clock = 20_000;
    burst();
    await vi.waitFor(() => expect(onDirty).toHaveBeenCalledTimes(1));
    expect(onDirty.mock.calls[0]?.[0]).toEqual([document.body]);
    clock += 100;
    burst();
    await wait(50);
    expect(onDirty).toHaveBeenCalledTimes(1);
  });

  it('stops observing after disconnect', async () => {
    const onDirty = watch();
    stop?.();
    document.getElementById('b')?.append(document.createElement('p'));
    await wait();
    expect(onDirty).not.toHaveBeenCalled();
  });
});

describe('routeKeyOf', () => {
  const key = (pathname: string, search = '', hash = '') => routeKeyOf({ pathname, search, hash });

  it('is the path and the query', () => {
    expect(key('/a/b', '?q=1')).toBe('/a/b?q=1');
    expect(key('/')).toBe('/');
  });

  it('ignores a plain fragment (scrolling a docs page rewrites it)', () => {
    expect(key('/docs', '', '#chapter-2')).toBe('/docs');
    expect(key('/docs', '', '#')).toBe('/docs');
  });

  it('counts a hash route, with or without the bang', () => {
    expect(key('/', '', '#/users/7')).toBe('/#/users/7');
    expect(key('/', '', '#!/users/7')).toBe('/#!/users/7');
  });
});

describe('watchMutations: route changes and the whole-page cooldown', () => {
  /** A manual observer, fake timers and a fake clock the watcher reads as well. */
  function manual(routeKey?: () => string) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(1_000_000);
    let feed!: MutationCallback;
    const onDirty = vi.fn<(elements: Element[]) => void>();
    stop = watchMutations({
      root: document.body,
      isOwn,
      onDirty,
      debounceMs: 5,
      burstLimit: 2,
      routeKey,
      createObserver: (callback) => {
        feed = callback;
        return { observe: () => {}, disconnect: () => {} };
      },
    });
    const record = (target: Element): MutationRecord =>
      ({
        type: 'childList',
        target,
        addedNodes: [document.createElement('i')],
        removedNodes: [],
      }) as unknown as MutationRecord;
    const targets = (count: number) =>
      Array.from({ length: count }, () => {
        const section = document.createElement('section');
        document.body.append(section);
        return section;
      });
    const burst = () => feed(targets(4).map(record), {} as MutationObserver);
    const small = () => feed(targets(1).map(record), {} as MutationObserver);
    const wide = () =>
      onDirty.mock.calls.filter(([els]) => els.length === 1 && els[0] === document.body);
    const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);
    return { onDirty, burst, small, wide, pass };
  }

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  /** Two whole-page rescans on the same route: the cooldown is now 4s. */
  async function raiseToFourSeconds(t: ReturnType<typeof manual>) {
    t.burst();
    await t.pass(20);
    expect(t.wide()).toHaveLength(1);
    await t.pass(2100);
    t.burst();
    await t.pass(20);
    expect(t.wide()).toHaveLength(2);
  }

  it('lets a burst on a new route in after one second, not after the raised cooldown', async () => {
    let route = '/a';
    const t = manual(() => route);
    await raiseToFourSeconds(t);
    await t.pass(500);
    route = '/b';
    t.burst();
    await t.pass(100);
    expect(t.wide()).toHaveLength(2);
    // The floor stays: about a second after the last whole-page rescan.
    await t.pass(500);
    expect(t.wide()).toHaveLength(3);
  });

  it('does not wait out an already queued cooldown when the route changes meanwhile', async () => {
    let route = '/a';
    const t = manual(() => route);
    await raiseToFourSeconds(t);
    // Same route: the burst waits for the 4s cooldown, in debounce-sized steps.
    await t.pass(1200);
    t.burst();
    await t.pass(100);
    expect(t.wide()).toHaveLength(2);
    // The page changes its URL while that wait is on: the next step lets the burst through.
    route = '/b';
    await t.pass(20);
    expect(t.wide()).toHaveLength(3);
  });

  it('keeps 1s, 2s, 4s while the route stays the same', async () => {
    const t = manual(() => '/a');
    t.burst();
    await t.pass(20);
    expect(t.wide()).toHaveLength(1);
    t.burst();
    await t.pass(1900);
    expect(t.wide()).toHaveLength(1);
    await t.pass(150);
    expect(t.wide()).toHaveLength(2);
    t.burst();
    await t.pass(3900);
    expect(t.wide()).toHaveLength(2);
    await t.pass(150);
    expect(t.wide()).toHaveLength(3);
  });

  it('keeps 1s, 2s, 4s without a route key', async () => {
    const t = manual();
    t.burst();
    await t.pass(20);
    expect(t.wide()).toHaveLength(1);
    t.burst();
    await t.pass(1900);
    expect(t.wide()).toHaveLength(1);
    await t.pass(150);
    expect(t.wide()).toHaveLength(2);
    t.burst();
    await t.pass(3900);
    expect(t.wide()).toHaveLength(2);
    await t.pass(150);
    expect(t.wide()).toHaveLength(3);
  });

  it('reads the route key at the start and in whole-page rounds only', async () => {
    const routeKey = vi.fn(() => '/a');
    const t = manual(routeKey);
    expect(routeKey).toHaveBeenCalledTimes(1);
    t.small();
    await t.pass(20);
    expect(t.onDirty).toHaveBeenCalledTimes(1);
    expect(routeKey).toHaveBeenCalledTimes(1);
    t.burst();
    await t.pass(20);
    expect(routeKey.mock.calls.length).toBeGreaterThan(1);
  });
});
