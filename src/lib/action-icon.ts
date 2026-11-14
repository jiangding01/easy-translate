import type { PageStatus } from '@/lib/messaging/protocol';

// The toolbar icon's per-tab status dot: amber while translating or translated,
// coral when something failed, nothing when idle. Drawing is injected so the
// bookkeeping stays testable outside a service worker.

export type IconImages = Record<string, ImageData>;

export interface ActionIconDeps {
  draw(status: PageStatus): Promise<IconImages>;
  setIcon(details: { tabId: number; imageData: IconImages }): Promise<void>;
}

export interface ActionIcon {
  show(tabId: number, status: PageStatus): Promise<void>;
  /** Navigation or close: the page's session is gone. */
  reset(tabId: number): Promise<void>;
  forget(tabId: number): void;
}

export const DOT_COLORS: Record<Exclude<PageStatus, 'idle'>, { hex: string; css: string }> = {
  running: { hex: '#f8b23d', css: 'oklch(0.81 0.15 76)' },
  done: { hex: '#f8b23d', css: 'oklch(0.81 0.15 76)' },
  error: { hex: '#f68771', css: 'oklch(0.74 0.14 32)' },
};

export function createActionIcon(deps: ActionIconDeps): ActionIcon {
  const images = new Map<PageStatus, Promise<IconImages>>();
  const shown = new Map<number, PageStatus>();

  const imagesFor = (status: PageStatus) => {
    let pending = images.get(status);
    if (!pending) {
      pending = deps.draw(status);
      images.set(status, pending);
      pending.catch(() => images.delete(status));
    }
    return pending;
  };

  const show = async (tabId: number, status: PageStatus) => {
    if ((shown.get(tabId) ?? 'idle') === status) return;
    shown.set(tabId, status);
    try {
      await deps.setIcon({ tabId, imageData: await imagesFor(status) });
    } catch {
      // Tab closed meanwhile, or drawing failed: the plain icon stays.
      shown.delete(tabId);
    }
  };

  return {
    show,
    reset: (tabId) => (shown.has(tabId) ? show(tabId, 'idle') : Promise.resolve()),
    forget: (tabId) => {
      shown.delete(tabId);
    },
  };
}

/** Draws the base icon at 16 and 32px with a knocked-out status dot in the bottom-right. */
export async function drawStatusIcon(
  status: PageStatus,
  loadBase: (size: 16 | 32) => Promise<ImageBitmap>,
): Promise<IconImages> {
  const result: IconImages = {};
  for (const size of [16, 32] as const) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(await loadBase(size), 0, 0, size, size);
    if (status !== 'idle') {
      const radius = (size * 6) / 16 / 2;
      const center = size - radius;
      // A transparent ring keeps the dot readable over any part of the icon.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(center, center, radius + size / 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      const color = DOT_COLORS[status];
      ctx.fillStyle = color.hex;
      ctx.fillStyle = color.css; // Ignored where OKLCH is not supported.
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    result[String(size)] = ctx.getImageData(0, 0, size, size);
  }
  return result;
}
