// Contrast gate for the color tokens in src/styles/tokens.css and tokens-isle.css (WCAG 2 ratios).
// Text pairs need 4.5:1, controls and focus rings 3:1. Zero dependencies on purpose.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// The isle material is split into its own file; both files keep the same three blocks.
const files = ['src/styles/tokens.css', 'src/styles/tokens-isle.css'];
const sources = await Promise.all(files.map((file) => readFile(resolve(file), 'utf8')));

/** `--et-color-*` declarations of the first matching block, merged across both files. */
function block(selectorPattern) {
  const tokens = new Map();
  sources.forEach((css, index) => {
    const start = css.search(selectorPattern);
    if (start < 0) throw new Error(`Block not found in ${files[index]}: ${selectorPattern}`);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    for (const [, name, value] of css
      .slice(open + 1, close)
      .matchAll(/--et-color-([\w-]+):\s*([^;]+);/g)) {
      // A token must be defined in exactly one file (the split moves, it does not copy).
      if (tokens.has(name)) throw new Error(`--et-color-${name} is defined in both token files`);
      tokens.set(name, value.trim());
    }
  });
  return tokens;
}

const light = block(/^:root,\n:host \{/m);
const dark = block(/^\[data-et-theme="dark"\]/m);
const media = block(/:root:not\(\[data-et-theme="light"\]\)/);

/** oklch(L C H [/ A]) → relative luminance (alpha ignored: only opaque tokens are paired). */
function luminance(value) {
  const match = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!match) throw new Error(`Not an opaque oklch() color: ${value}`);
  const [L, C, H] = match.slice(1).map(Number);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function ratio(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const UI = 3;
const surfaces = ['bg', 'surface', 'elevated'];
/** [foreground, backgrounds, minimum] */
const pairs = [
  ['text', [...surfaces, 'field', 'accent-soft'], TEXT],
  ['muted', [...surfaces, 'field'], TEXT],
  ['faint', [...surfaces, 'field'], TEXT],
  ['accent-ink', [...surfaces, 'accent-soft'], TEXT],
  ['warn', [...surfaces, 'warn-soft'], TEXT],
  ['ok', surfaces, TEXT],
  ['on-accent', ['accent', 'accent-hover'], TEXT],
  ['on-warn', ['warn'], TEXT],
  ['isle-text', ['isle', 'isle-2'], TEXT],
  ['isle-dim', ['isle'], TEXT],
  ['isle-ok', ['isle'], TEXT],
  ['isle-warn', ['isle'], TEXT],
  ['focus', [...surfaces, 'field'], UI],
  // Unselected radio and switch outlines use `faint`; the selected fill is `accent`.
  ['accent', ['isle'], UI],
];

const failures = [];
let checked = 0;
for (const [theme, tokens] of [
  ['light', light],
  ['dark', dark],
]) {
  for (const [fg, backgrounds, min] of pairs) {
    for (const bg of backgrounds) {
      const value = ratio(tokens.get(fg), tokens.get(bg));
      checked += 1;
      if (value < min)
        failures.push(`${theme}: ${fg} on ${bg} = ${value.toFixed(2)} (needs ${min})`);
    }
  }
}

// The prefers-color-scheme block must repeat the forced dark theme exactly.
for (const [name, value] of dark) {
  if (media.get(name) !== value) failures.push(`dark media block differs at --et-color-${name}`);
}
if (media.size !== dark.size) failures.push('dark media block has a different set of colors');

if (failures.length > 0) {
  console.error(`Contrast check failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`Contrast OK: ${checked} pairs in light and dark.`);
