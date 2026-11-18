// The selection card's shadow stylesheet. A string only: the CSSStyleSheet is built at
// mount, so evaluating this module touches no DOM (check-build runs the bundle without
// one). Colors and the shadow come from tokens-isle.css (the isle's material); the two
// colors that file lacks are local (`--c3` the pressed fill, `--on` the ink on amber,
// tokens.css `--et-color-on-accent`). Sizes follow the SelectionM3a prototype. `.r` resets
// everything the page could pass down to the host (`all: initial`; custom properties,
// the tokens, are not affected). No `url(` anywhere: the module may not load resources
// by address.

/** tokens.css `--et-font-sans` (system fonts only). */
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

export const CARD_CSS = `
.r{all:initial;position:absolute;inset:0;pointer-events:none;font:13px/20px ${SANS};color:var(--et-color-isle-text);cursor:default;user-select:none;-webkit-user-select:none;-webkit-font-smoothing:antialiased;--c3:oklch(0.34 0.01 70);--on:oklch(0.22 0.04 65)}
:host([data-et-theme="dark"]) .r{--c3:oklch(0.38 0.01 70)}
*{box-sizing:border-box}
button{font:inherit;color:inherit;margin:0;padding:0;border:0;background:none;cursor:pointer}
.au,.sh,.cw,.tp{position:absolute;left:0;top:0;opacity:0}
.au{width:24px;height:24px;color:var(--et-color-accent);transform-origin:12px 12px}
.sh{box-shadow:var(--et-shadow-isle)}
.sl,.tn{position:absolute;inset:0}
.sl{background:var(--et-color-isle);clip-path:inset(50%);pointer-events:auto}
.tn{background:var(--et-color-accent);pointer-events:none}
.cw{width:360px;visibility:hidden}
.cn{position:relative;display:flex;flex-direction:column;max-height:380px}
.r:not([data-view="card"]) .cn{pointer-events:none}
.hd,.ft,.dir,.eb,.ib,.src,.o,.lh{display:flex;align-items:center}
.hd{gap:6px;flex-shrink:0;height:40px;padding:0 6px 0 14px;touch-action:none}
.r[data-pin] .hd{cursor:grab}
.r[data-drag] .hd{cursor:grabbing}
.dir{gap:5px;min-width:0;font-size:12px;color:var(--et-color-isle-dim);white-space:nowrap}
.dg{flex-grow:1;align-self:stretch}
.eb{gap:3px;height:28px;padding:0 7px 0 9px;border-radius:999px;color:var(--et-color-isle-dim);font-size:11.5px;font-weight:600;letter-spacing:.02em}
.eb:hover,.eb[aria-expanded="true"],.ib:hover:not([aria-disabled="true"]),.ib[aria-pressed="true"],.o:hover:not(:disabled){background:var(--et-color-isle-2);color:var(--et-color-isle-text)}
.eb>svg,.sc{transition:transform .2s}
.eb[aria-expanded="true"]>svg,.src[data-open] .sc{transform:rotate(180deg)}
.bd{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 14px 14px;scrollbar-width:thin}
.bd,.op{scrollbar-color:color-mix(in oklab,var(--et-color-isle-dim) 40%,transparent) transparent}
.bd,.ft,.ls{transition:opacity .12s}
.bd[data-more]{mask-image:linear-gradient(#000 calc(100% - 22px),transparent)}
.src{align-items:flex-start;gap:6px;margin-bottom:8px;color:var(--et-color-isle-dim);font-size:12.5px;line-height:19px}
.st:hover{color:var(--et-color-isle-text)}
.k,.sc{cursor:pointer}
.k{flex-shrink:0;margin-top:1px;padding:0 5px;border-radius:4px;background:var(--et-color-isle-2);font-size:11px;line-height:17px;white-space:nowrap}
.sw{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 8px;flex:1;min-width:0}
.st{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:Georgia,serif;text-align:left;line-height:inherit}
.ph{display:contents}
.lm,.pb{white-space:nowrap}
.pb{display:inline-flex;align-items:center;gap:3px;margin:0 -4px;padding:0 4px;border-radius:5px}
.pb:hover{background:var(--et-color-isle-2);color:var(--et-color-isle-text)}
.pb:focus-visible{outline:2px solid var(--et-color-accent);outline-offset:-1px}
.pl{font-size:10.5px;opacity:.7}
.pb svg{width:12px;height:12px}
.src[data-open] .st{white-space:normal;overflow-wrap:anywhere}
.sc{flex-shrink:0;margin-top:3px}
.sk{display:grid;gap:10px;padding:7px 0 5px}
.sk span{position:relative;height:9px;border-radius:9px;background:var(--et-color-isle-2);overflow:hidden}
.sk span::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,oklch(1 0 0 / .09),transparent);transform:translateX(-100%);animation:et-sweep 1.1s ease-in-out infinite}
@keyframes et-sweep{to{transform:translateX(100%)}}
.tw{user-select:text;-webkit-user-select:text;cursor:text}
.tw ::selection{background:oklch(0.82 0.15 78 / .38);color:var(--et-color-isle-text)}
.tx{margin:0;font-size:15px;line-height:24px;letter-spacing:.01em;overflow-wrap:anywhere}
.tx+.tx{margin-top:8px}
.ch{animation:et-in .18s ease-out both}
@keyframes et-in{from{opacity:0;filter:blur(2px)}}
.cr{display:inline-block;width:2px;height:15px;margin-left:2px;vertical-align:-2px;border-radius:1px;background:var(--et-color-accent);animation:et-pulse 1s ease-in-out infinite}
@keyframes et-pulse{50%{opacity:.25}}
.nc{margin:0}
.er{display:flex;gap:9px}
.ed{flex-shrink:0;width:6px;height:6px;margin-top:7px;border-radius:9px;background:var(--et-color-isle-warn)}
.ea{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.bt{height:30px;padding:0 12px;border-radius:999px;font-size:12.5px;font-weight:500;background:var(--et-color-isle-2)}
.bt:hover{background:var(--c3)}
.ba,.ba:hover{background:var(--et-color-accent);color:var(--on)}
.ft{gap:2px;flex-shrink:0;height:40px;padding:0 6px;border-top:1px solid var(--et-color-isle-2)}
.fs{flex-grow:1}
.ib{justify-content:center;width:32px;height:32px;border-radius:999px;color:var(--et-color-isle-dim)}
.ib[aria-disabled="true"]{opacity:.4;cursor:default}
.ib[aria-pressed="true"]{color:var(--et-color-accent)}
.ib[data-ok]{color:var(--et-color-isle-ok)}
.ls{position:absolute;left:0;right:0;top:40px;display:flex;flex-direction:column;padding:5px;border-top:1px solid var(--et-color-isle-2);opacity:0;pointer-events:none}
.r[data-list] .ls{opacity:1;pointer-events:auto}
.r[data-list] .bd,.r[data-list] .ft{opacity:0;pointer-events:none}
.lh{flex-shrink:0;height:28px;padding:0 10px;font-size:11.5px;color:var(--et-color-isle-dim)}
.op{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.o{gap:8px;flex-shrink:0;width:100%;height:34px;padding:0 10px;border-radius:8px;text-align:left}
.o[aria-selected="true"]{font-weight:500}
.o:disabled{color:var(--et-color-isle-dim);cursor:default}
.nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi{display:block;flex-shrink:0;width:15px;height:15px}
.pf{display:flex;align-items:center;justify-content:center;width:auto;min-width:15px;padding:0 2px;border:1px solid;border-radius:4px;font-size:9.5px;line-height:1}
.o:disabled .pi{opacity:.5}
.cm,.no{flex-shrink:0;margin-left:auto}
.cm{color:var(--et-color-accent)}
.no{font-size:11.5px;font-weight:400;color:var(--et-color-isle-dim)}
.lf{flex-shrink:0;padding:6px 10px 2px;font-size:11px;line-height:16px;color:var(--et-color-isle-dim)}
.zn{position:absolute;width:28px;height:28px;border-radius:50%;display:none;cursor:pointer;pointer-events:auto}
.r[data-view="dot"] .zn{display:block}
.tp{white-space:normal;width:max-content;max-width:min(280px,calc(100vw - 16px));padding:4px 8px;border-radius:6px;background:var(--et-color-isle);font-size:12px;line-height:16px;box-shadow:var(--et-shadow-isle);transition:opacity .12s ease-out}
.tp:empty{display:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.r[data-rm] *{animation:none!important;transition:none!important}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
