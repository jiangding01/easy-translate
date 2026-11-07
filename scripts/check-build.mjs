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
assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'storage']);
assert.ok(!manifest.key && !manifest.update_url, 'Legacy extension identity must not be copied');

const files = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons ?? {}),
  ...manifest.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
];
await Promise.all(files.map((file) => access(resolve(output, file))));
console.log(`MV3 build verified: ${files.length} manifest file references exist.`);
