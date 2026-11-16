// Gzip size budget for the production build. Zero dependencies on purpose.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const output = resolve('.output/chrome-mv3');
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'));

/** Paths in HTML are absolute to the extension root ("/chunks/x.js"). */
const toOutputPath = (file) => resolve(output, file.replace(/^\//, ''));

async function gzipSize(file) {
  return gzipSync(await readFile(toOutputPath(file))).length;
}

/** All JS a page loads: entry scripts plus modulepreloaded shared chunks. */
async function pageScripts(htmlFile) {
  const html = await readFile(toOutputPath(htmlFile), 'utf8');
  const files = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const isScript = tag.startsWith('<script');
    const isPreload = /\brel=["']?modulepreload\b/.test(tag);
    const url = tag.match(isScript ? /\bsrc=["']?([^"'\s>]+)/ : /\bhref=["']?([^"'\s>]+)/)?.[1];
    if (url && (isScript || isPreload) && url.endsWith('.js')) files.add(url);
  }
  return [...files];
}

// Files listed as web accessible resources: the on-demand modules (page runtime).
const runtimeFiles = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources);

const entries = [
  {
    name: 'content',
    // First-screen bootstrap only; the session lives in the on-demand module below.
    budget: 6 * KB,
    files: manifest.content_scripts?.flatMap((script) => script.js ?? []) ?? [],
  },
  {
    name: 'page-runtime',
    // Raise explicitly when the island UI lands (M2b PR2).
    budget: 16 * KB,
    files: runtimeFiles,
  },
  {
    name: 'background',
    budget: 60 * KB,
    files: manifest.background?.service_worker ? [manifest.background.service_worker] : [],
  },
  {
    name: 'popup',
    // Raised from 80KB in M1 3b: React DOM (~60KB) is a fixed cost and the panel now
    // shares the settings page's select and engine view. Past 90KB, evaluate a lighter
    // runtime before raising again.
    budget: 90 * KB,
    files: manifest.action?.default_popup ? await pageScripts(manifest.action.default_popup) : [],
  },
  {
    name: 'options',
    budget: 150 * KB,
    files: manifest.options_ui?.page ? await pageScripts(manifest.options_ui.page) : [],
  },
];

let failed = false;
const rows = [];
for (const entry of entries) {
  if (entry.files.length === 0) {
    failed = true;
    rows.push({ entry: entry.name, gzip: '-', budget: entry.budget, status: 'MISSING' });
    continue;
  }
  const sizes = await Promise.all(entry.files.map(gzipSize));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const ok = total <= entry.budget;
  if (!ok) failed = true;
  rows.push({ entry: entry.name, gzip: total, budget: entry.budget, status: ok ? 'ok' : 'OVER' });
  entry.files.forEach((file, index) => {
    console.log(
      `  ${entry.name.padEnd(12)} ${(sizes[index] / KB).toFixed(2).padStart(8)} KB  ${file}`,
    );
  });
}

const format = (value) => (typeof value === 'number' ? `${(value / KB).toFixed(2)} KB` : value);
console.log('\nentry        gzip         budget       status');
for (const row of rows) {
  console.log(
    `${row.entry.padEnd(13)} ${format(row.gzip).padEnd(12)} ${format(row.budget).padEnd(12)} ${row.status}`,
  );
}

if (failed) {
  console.error('\nSize check failed: an entry is over budget or its files could not be found.');
  process.exit(1);
}
console.log('\nSize check passed.');
