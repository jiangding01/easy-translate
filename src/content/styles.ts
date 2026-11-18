// The one stylesheet injected into pages. Specificity is raised by repeating the
// attribute; only display, margin, decoration, background, opacity and font-size
// are set (plus, in translation-only, the line height and text spacing the zeroed root
// would otherwise pass down), everything else is inherited from the host so
// translations read native.

export const STYLE_ATTR = 'data-et';

const CSS = `
et-tr[data-et-s][data-et-s]{display:block;margin:.25em 0 0;padding:0;border:0;font:inherit;color:inherit;text-align:inherit}
et-tr[data-et-s][data-et-inline]{display:inline;margin:0 0 0 .3em}
et-tr[data-et-s="faded"][data-et-s]{opacity:.72}
et-tr[data-et-s="faded"][data-et-host="dark"]{opacity:.78}
et-tr[data-et-s="underline"][data-et-s]{text-decoration:underline dotted 1px oklch(0.52 0.12 60 / .7);text-underline-offset:.28em;text-decoration-skip-ink:none}
et-tr[data-et-s="underline"][data-et-host="dark"]{text-decoration-color:oklch(0.82 0.15 78 / .7)}
et-tr[data-et-s="highlight"][data-et-s]{background:oklch(0.81 0.15 76 / .18);padding:.1em .25em;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone;width:fit-content;max-width:100%}
et-tr[data-et-s="highlight"][data-et-host="dark"]{background:oklch(0.82 0.15 78 / .22)}
et-tr[data-et-s][data-et-state="error"]{opacity:1;background:none;text-decoration:none;padding:0;font-family:system-ui,-apple-system,"PingFang SC",sans-serif;font-size:12px;line-height:18px;color:oklch(0.55 0.17 30)}
et-tr[data-et-state="error"][data-et-host="dark"]{color:oklch(0.74 0.14 32)}
et-tr[data-et-state="error"] button{all:unset;cursor:pointer;margin-left:.4em;padding:0 3px;border-radius:4px;text-decoration:underline;text-underline-offset:3px}
et-tr[data-et-state="error"] button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
[data-et-only][data-et-only]{font-size:0!important}
[data-et-only][data-et-only]>:not(et-tr){display:none!important}
[data-et-only][data-et-only]>et-tr{font-size:var(--et-fs)!important;line-height:var(--et-lh)!important;letter-spacing:var(--et-ls,normal)!important;word-spacing:var(--et-ws,normal)!important;margin-top:0}
[data-et-unclamp][data-et-unclamp]{-webkit-line-clamp:unset!important;line-clamp:unset!important}
`;

/**
 * Adds our stylesheet and returns the node; callers remove that exact node. A page
 * can plant its own `<style data-et>`, so an existing one is never trusted as ours.
 */
export function injectStyles(doc: Document): HTMLStyleElement {
  const style = doc.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).append(style);
  return style;
}

export function removeStyles(style: HTMLStyleElement | undefined): void {
  style?.remove();
}
