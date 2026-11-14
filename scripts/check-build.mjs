import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('.output/chrome-mv3');
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.background?.service_worker, 'Missing service worker');
assert.ok(manifest.action?.default_popup, 'Missing popup');
assert.ok(manifest.options_ui?.page, 'Missing options page');
assert.ok(manifest.content_scripts?.length, 'Missing content script');
// Exact sets: any widening of permissions must fail the build.
const sorted = (list) => [...(list ?? [])].sort();
assert.deepEqual(sorted(manifest.permissions), ['activeTab', 'storage']);
assert.deepEqual(
  sorted(manifest.host_permissions),
  [
    'https://api.deepseek.com/*',
    'https://api.openai.com/*',
    'https://generativelanguage.googleapis.com/*',
    'https://translate.googleapis.com/*',
  ].sort(),
);
assert.deepEqual(
  sorted(manifest.optional_host_permissions),
  ['http://127.0.0.1/*', 'http://localhost/*', 'https://*/*'].sort(),
);
assert.ok(!manifest.key && !manifest.update_url, 'Legacy extension identity must not be copied');
// The background draws the toolbar status dot over icon/16.png and icon/32.png.
assert.equal(manifest.icons?.['16'], 'icon/16.png');
assert.equal(manifest.icons?.['32'], 'icon/32.png');
assert.equal(manifest.minimum_chrome_version, '117');
assert.deepEqual(
  manifest.commands?.['translate-page']?.suggested_key,
  { default: 'Alt+A', mac: 'MacCtrl+Shift+A' },
  'Missing or changed translate-page shortcut',
);

const files = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons ?? {}),
  ...manifest.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
];
await Promise.all(files.map((file) => access(resolve(output, file))));
console.log(`MV3 build verified: ${files.length} manifest file references exist.`);
