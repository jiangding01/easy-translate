// The isle's shadow stylesheet. A string only: the CSSStyleSheet is built at mount,
// so evaluating this module touches no DOM (check-build runs the bundle without one).
// Colors and the shadow come from tokens-isle.css. Sizes are the prototype's (IsleM2)
// element geometry; type sizes follow tokens.css `--et-fs-inject-*` where one exists
// (13/20 = md, 12/18 = sm, 11/16 = xs), the rest are the prototype's in-between steps.
// No `url(` anywhere: the module may not load resources by address.

/** tokens.css `--et-font-sans` (system fonts only). */
const SANS =
  '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
/** tokens.css `--et-font-mono`. */
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

export const ISLE_CSS = `
.r{position:absolute;inset:0;pointer-events:none;font:400 13px/20px ${SANS};letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;text-align:left;text-shadow:none;direction:ltr;writing-mode:horizontal-tb;white-space:normal;color:var(--et-color-isle-text);visibility:visible;cursor:default;user-select:none;-webkit-user-select:none;-webkit-font-smoothing:antialiased}
.r *{box-sizing:border-box}
.r button{font:inherit;color:inherit;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.sl,.ln{position:absolute;inset:0;clip-path:inset(50%)}
.sl{background:var(--et-color-isle);pointer-events:auto}
.ln{background:var(--et-color-isle-line)}
.sh{position:absolute;left:0;top:0;width:0;height:0;opacity:0;box-shadow:var(--et-shadow-isle);transition:opacity 120ms ease-out}
.au{position:absolute;left:0;top:0;width:24px;height:24px;opacity:0;color:var(--et-color-accent);transform-origin:12px 12px}
.au svg{position:absolute;inset:0}
.r[data-fail] .au{color:var(--et-color-warn)}
.arc{opacity:0;transform-origin:50% 50%;transition:opacity 200ms}
.r[data-run] .arc{opacity:1;animation:et-spin 1s linear infinite}
@keyframes et-spin{to{transform:rotate(360deg)}}
.tn{position:absolute;width:10px;height:10px;border-radius:999px;background:var(--et-color-accent);transform:scale(0);transition:background-color 200ms}
.r[data-fail] .tn{background:var(--et-color-warn)}
.hit{position:absolute;width:26px;height:26px;border-radius:999px;pointer-events:none}
.r[data-view="dot"] .hit{pointer-events:auto;cursor:pointer}
.bar,.ls{position:absolute;opacity:0;pointer-events:none}
.r[data-view="isle"] .bar,.r[data-view="list"] .bar,.r[data-view="list"] .ls{pointer-events:auto}
.bar{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.seg{position:relative;display:flex;flex-direction:column;gap:2px;padding:3px}
.r[data-dock="bottom"] .bar,.r[data-dock="bottom"] .seg{flex-direction:row}
.ind{position:absolute;left:3px;top:3px;width:28px;height:28px;border-radius:999px;background:var(--et-color-isle-2)}
.md{position:relative;display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--et-color-isle-dim);font-size:12.5px}
.md:hover{color:var(--et-color-isle-text)}
.md[aria-checked="true"]{color:var(--et-color-accent);font-weight:600}
.sep{flex-shrink:0;width:14px;height:1px;background:var(--et-color-isle-2)}
.r[data-dock="bottom"] .sep{width:1px;height:14px}
.ib{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;width:32px;height:32px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--et-color-isle-dim)}
.ib:hover,.ib[aria-expanded="true"]{background:var(--et-color-isle-2);color:var(--et-color-isle-text)}
.rt,.rt:hover{color:var(--et-color-isle-warn)}
.rt[hidden]{display:none}
.rt b{font-size:10px;line-height:11px;font-weight:600}
.eg{font-size:11.5px;font-weight:600;letter-spacing:.02em}
.eg[data-err]::after{content:"";position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:999px;background:var(--et-color-isle-warn)}
.ls{display:flex;flex-direction:column;padding:5px}
.r[data-dock="right"] .ls{border-right:1px solid var(--et-color-isle-2)}
.r[data-dock="left"] .ls{border-left:1px solid var(--et-color-isle-2)}
.r[data-dock="bottom"] .ls{border-bottom:1px solid var(--et-color-isle-2)}
.lh{display:flex;align-items:center;flex-shrink:0;height:28px;padding:0 10px;font-size:11.5px;color:var(--et-color-isle-dim)}
.op{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.o{display:flex;align-items:center;gap:8px;flex-shrink:0;width:100%;height:34px;padding:0 10px;border:0;border-radius:8px;background:transparent;text-align:left;color:var(--et-color-isle-text)}
.o:hover:not(:disabled){background:var(--et-color-isle-2)}
.o[aria-selected="true"]{font-weight:500}
.o:disabled{color:var(--et-color-isle-dim);cursor:default}
.nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb{flex-shrink:0;font:400 11px/16px ${MONO};color:var(--et-color-isle-dim)}
.ck{flex-shrink:0;margin-left:auto;color:var(--et-color-accent)}
.nt{flex-shrink:0;margin-left:auto;font-size:11.5px;font-weight:400;color:var(--et-color-isle-dim)}
.lf{flex-shrink:0;padding:6px 10px 0;font-size:11px;line-height:16px;color:var(--et-color-isle-dim)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.tp{position:absolute;left:0;top:0;opacity:0;pointer-events:none;white-space:nowrap;padding:4px 8px;border-radius:6px;background:var(--et-color-isle);color:var(--et-color-isle-text);font-size:12px;line-height:16px;box-shadow:var(--et-shadow-isle)}
.tp:empty{display:none}
.r[data-rm] .arc{animation:none}
@media (prefers-reduced-motion:reduce){.arc{animation:none!important}}
@media print{.r{display:none}}
`;
