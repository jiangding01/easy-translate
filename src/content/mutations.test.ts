// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchMutations } from './mutations';

const isOwn = (node: Node) => {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (current.nodeName === 'ET-TR') return true;
  }
  return false;
};

let stop: (() => void) | undefined;
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function watch(options: { burstLimit?: number; now?: () => number } = {}) {
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
