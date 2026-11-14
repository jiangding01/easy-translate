import type { ViewportObserver } from './session';

/** Roots within 1000px of the viewport count as "in range": translated before they scroll in. */
export const VIEWPORT_MARGIN = '1000px 0px';

export function createIntersectionViewport(
  onChange: (targets: Element[], visible: boolean[]) => void,
): ViewportObserver {
  const observer = new IntersectionObserver(
    (entries) =>
      onChange(
        entries.map((entry) => entry.target),
        entries.map((entry) => entry.isIntersecting),
      ),
    { rootMargin: VIEWPORT_MARGIN },
  );
  return {
    observe: (target) => observer.observe(target),
    unobserve: (target) => observer.unobserve(target),
    disconnect: () => observer.disconnect(),
  };
}
