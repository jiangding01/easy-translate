// Extension icon, direction "暗岛微光": a warm-black squircle; a warm-white line is the
// source text, a shorter amber pill below it is the translation. Since the rename to
// 译屿 / Islet Translate, the pill is the islet (the isle capsule on pages) and faint amber
// reflections under it are the dark water it glows on.
// One geometry table per size drives both the SVG sources (docs/assets/icon) and the
// PNGs (public/icon). 16, 32 and 48 are drawn on their own pixel grid, never scaled
// down; 128 follows the Chrome Web Store layout: 16px transparent margin, 96px body.
// Keep the bottom-right corner free: the toolbar status dot is knocked out there.
// Zero dependencies on purpose. Run `npm run build:icons` after changing the table.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const PLATE = '#181512'; // --et-color-isle, oklch(0.2 0.008 70)
const PLATE_TOP = '#2c2823';
const PLATE_BOTTOM = '#161310';
const INK = '#f7f5f1'; // --et-color-isle-text family
const INK_SOFT = '#f2efea';
const AMBER = '#f8b23d'; // --et-color-accent, oklch(0.81 0.15 76)
const AMBER_TOP = '#ffc860';
const AMBER_BOTTOM = '#f2a531';
const SQUIRCLE_EXPONENT = 5;

/** [x, y, width, height]; ends are fully rounded. Reflections add an opacity. */
const ICONS = [
  {
    size: 16,
    plate: [0, 0, 16, 16],
    line: [3, 4, 10, 2],
    pill: [3, 8, 6, 3],
    reflections: [[4, 12, 4, 1, 0.45]],
    ink: INK,
  },
  {
    size: 32,
    plate: [0, 0, 32, 32],
    line: [7, 9, 18, 3],
    pill: [7, 16, 12, 5],
    reflections: [[9, 23, 8, 2, 0.32]],
    ink: INK,
  },
  {
    size: 48,
    plate: [0, 0, 48, 48],
    line: [10, 14, 28, 4],
    pill: [10, 25, 18, 7],
    reflections: [[12, 35, 14, 2, 0.3]],
    ink: INK_SOFT,
    gradient: true,
    glow: { sigma: 2.5, opacity: 0.45, dy: 0.5 },
  },
  {
    size: 128,
    plate: [16, 16, 96, 96],
    line: [37, 43, 54, 9],
    pill: [37, 64, 36, 15],
    reflections: [
      [42, 85, 26, 5, 0.3],
      [47, 94, 16, 3, 0.14],
    ],
    ink: INK_SOFT,
    gradient: true,
    glow: { sigma: 7, opacity: 0.55, dy: 1 },
  },
];

// ---- geometry -------------------------------------------------------------

function insideSquircle([x0, y0, w, h], x, y) {
  const a = w / 2;
  const b = h / 2;
  const n = SQUIRCLE_EXPONENT;
  return Math.abs((x - x0 - a) / a) ** n + Math.abs((y - y0 - b) / b) ** n <= 1;
}

function insidePill([x0, y0, w, h], x, y) {
  const r = h / 2;
  if (y < y0 || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  return (x - cx) ** 2 + (y - y0 - r) ** 2 <= r * r;
}

function squirclePath([x0, y0, w, h], points) {
  const a = w / 2;
  const b = h / 2;
  const curve = (t) => Math.sign(t) * Math.abs(t) ** (2 / SQUIRCLE_EXPONENT);
  const coords = [];
  for (let i = 0; i < points; i++) {
    const t = (i / points) * 2 * Math.PI;
    const x = x0 + a + a * curve(Math.cos(t));
    const y = y0 + b + b * curve(Math.sin(t));
    coords.push(`${+x.toFixed(2)} ${+y.toFixed(2)}`);
  }
  return `M${coords.join('L')}Z`;
}

// ---- raster ---------------------------------------------------------------

const SUBSAMPLES = 16;

function coverage(size, inside) {
  const mask = new Float64Array(size * size);
  const step = 1 / SUBSAMPLES;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          if (inside(px + (sx + 0.5) * step, py + (sy + 0.5) * step)) hits++;
        }
      }
      mask[py * size + px] = hits / SUBSAMPLES ** 2;
    }
  }
  return mask;
}

function blur(mask, size, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  const weights = kernel.map((v) => v / sum);
  const pass = (src, horizontal) => {
    const out = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? x + k : x;
          const sy = horizontal ? y : y + k;
          if (sx >= 0 && sx < size && sy >= 0 && sy < size) {
            acc += src[sy * size + sx] * weights[k + radius];
          }
        }
        out[y * size + x] = acc;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);

/** Vertical gradient between two colors over [y0, y1], evaluated at pixel centers. */
const vertical = (top, bottom, y0, y1) => {
  const a = rgb(top);
  const b = rgb(bottom);
  return (y) => {
    const t = Math.min(Math.max((y + 0.5 - y0) / (y1 - y0), 0), 1);
    return a.map((v, i) => v + (b[i] - v) * t);
  };
};
const solid = (hex) => {
  const c = rgb(hex);
  return () => c;
};

function rasterize(icon) {
  const { size, plate, line, pill } = icon;
  const [, py, , ph] = plate;
  const [, pillY, , pillH] = pill;
  const plateMask = coverage(size, (x, y) => insideSquircle(plate, x, y));
  const layers = [
    {
      mask: plateMask,
      color: icon.gradient ? vertical(PLATE_TOP, PLATE_BOTTOM, py, py + ph) : solid(PLATE),
    },
    {
      mask: coverage(size, (x, y) => insidePill(line, x, y)),
      color: solid(icon.ink),
    },
  ];
  if (icon.glow) {
    const { sigma, opacity, dy } = icon.glow;
    const glow = blur(
      coverage(size, (x, y) => insidePill(pill, x, y - dy)),
      size,
      sigma,
    ).map((v, i) => v * opacity * plateMask[i]);
    layers.push({ mask: glow, color: solid(AMBER) });
  }
  layers.push({
    mask: coverage(size, (x, y) => insidePill(pill, x, y)),
    color: icon.gradient ? vertical(AMBER_TOP, AMBER_BOTTOM, pillY, pillY + pillH) : solid(AMBER),
  });
  for (const [x, y, w, h, opacity] of icon.reflections) {
    layers.push({
      mask: coverage(size, (px, py) => insidePill([x, y, w, h], px, py)).map((v) => v * opacity),
      color: solid(AMBER),
    });
  }

  // Premultiplied source-over, then back to straight alpha for PNG.
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const layer of layers) {
        const alpha = layer.mask[i];
        if (alpha <= 0) continue;
        const [cr, cg, cb] = layer.color(y);
        r = cr * alpha + r * (1 - alpha);
        g = cg * alpha + g * (1 - alpha);
        b = cb * alpha + b * (1 - alpha);
        a = alpha + a * (1 - alpha);
      }
      const out = a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0];
      out.forEach((v, c) => {
        pixels[i * 4 + c] = Math.round(Math.min(Math.max(v, 0), 1) * 255);
      });
    }
  }
  return pixels;
}

// ---- PNG ------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- SVG ------------------------------------------------------------------

function svg(icon) {
  const { size, plate, line, pill } = icon;
  const [, py, , ph] = plate;
  const rect = ([x, y, w, h], fill, extra = '') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"${extra}/>`;
  const defs = [];
  let plateFill = PLATE;
  let pillFill = AMBER;
  if (icon.gradient) {
    plateFill = 'url(#plate)';
    pillFill = 'url(#pill)';
    defs.push(
      `<linearGradient id="plate" x1="0" y1="${py}" x2="0" y2="${py + ph}" gradientUnits="userSpaceOnUse"><stop stop-color="${PLATE_TOP}"/><stop offset="1" stop-color="${PLATE_BOTTOM}"/></linearGradient>`,
      `<linearGradient id="pill" x1="0" y1="${pill[1]}" x2="0" y2="${pill[1] + pill[3]}" gradientUnits="userSpaceOnUse"><stop stop-color="${AMBER_TOP}"/><stop offset="1" stop-color="${AMBER_BOTTOM}"/></linearGradient>`,
    );
  }
  const platePath = squirclePath(plate, size >= 128 ? 160 : 96);
  const body = [`<path d="${platePath}" fill="${plateFill}"/>`];
  body.push(rect(line, icon.ink));
  if (icon.glow) {
    const { sigma, opacity, dy } = icon.glow;
    defs.push(
      `<clipPath id="clip"><path d="${platePath}"/></clipPath>`,
      `<filter id="glow" x="-100%" y="-300%" width="300%" height="700%"><feGaussianBlur stdDeviation="${sigma}"/></filter>`,
    );
    const [x, y, w, h] = pill;
    body.push(
      `<g clip-path="url(#clip)">${rect([x, y + dy, w, h], AMBER, ` opacity="${opacity}" filter="url(#glow)"`)}</g>`,
    );
  }
  body.push(rect(pill, pillFill));
  for (const [x, y, w, h, opacity] of icon.reflections) {
    body.push(rect([x, y, w, h], AMBER, ` opacity="${opacity}"`));
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    ...(defs.length ? [`<defs>${defs.join('')}</defs>`] : []),
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

// ---- main -----------------------------------------------------------------

const pngDir = resolve('public/icon');
const svgDir = resolve('docs/assets/icon');
await mkdir(pngDir, { recursive: true });
await mkdir(svgDir, { recursive: true });
for (const icon of ICONS) {
  await writeFile(resolve(pngDir, `${icon.size}.png`), encodePng(icon.size, rasterize(icon)));
  await writeFile(resolve(svgDir, `icon-${icon.size}.svg`), svg(icon));
}
// A scalable master for docs and branding: the 128 design cropped to its body, without the
// store's transparent margin.
const master = ICONS.find((icon) => icon.size === 128);
const [mx, my, mw, mh] = master.plate;
await writeFile(
  resolve(svgDir, 'icon.svg'),
  svg(master).replace(
    'width="128" height="128" viewBox="0 0 128 128"',
    `width="${mw}" height="${mh}" viewBox="${mx} ${my} ${mw} ${mh}"`,
  ),
);
console.log(`Icons written: ${ICONS.map((icon) => icon.size).join(', ')}px, and icon.svg.`);
