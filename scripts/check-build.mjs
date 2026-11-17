import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const output = resolve('.output/chrome-mv3');
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.background?.service_worker, 'Missing service worker');
assert.ok(manifest.action?.default_popup, 'Missing popup');
assert.ok(manifest.options_ui?.page, 'Missing options page');
assert.ok(manifest.content_scripts?.length, 'Missing content script');
// Exact sets: any widening of permissions must fail the build.
const sorted = (list) => [...(list ?? [])].sort();
assert.deepEqual(sorted(manifest.permissions), ['activeTab', 'contextMenus', 'storage']);
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
assert.equal(manifest.minimum_chrome_version, '130');
assert.deepEqual(
  manifest.commands?.['translate-page']?.suggested_key,
  { default: 'Alt+A', mac: 'MacCtrl+Shift+A' },
  'Missing or changed translate-page shortcut',
);
assert.deepEqual(
  manifest.commands?.['translate-selection']?.suggested_key,
  { default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' },
  'Missing or changed translate-selection shortcut',
);

// The on-demand runtimes: the only web accessible resources, reachable only by the content
// script through a dynamic URL.
const WAR_MATCHES = ['http://*/*', 'https://*/*'];
assert.deepEqual(
  manifest.web_accessible_resources,
  [
    { resources: ['page-runtime.js'], matches: WAR_MATCHES, use_dynamic_url: true },
    { resources: ['selection-runtime.js'], matches: WAR_MATCHES, use_dynamic_url: true },
  ],
  'Missing or changed web_accessible_resources',
);

// Each file registers its factory under its own key. Keep in sync with
// src/content/runtime-contract.ts.
const RUNTIME_KEYS = {
  'page-runtime.js': 'easy-translate.page-runtime',
  'selection-runtime.js': 'easy-translate.selection-runtime',
};
// The one allowed read of the extension ID: wxt/browser picking `browser` or `chrome`.
// If WXT rewrites this shim the check fails loudly; inspect the new form before exempting it.
const WXT_BROWSER_SHIM = 'globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome';

const runtimeFiles = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
for (const runtimeFile of runtimeFiles) {
  const key = RUNTIME_KEYS[runtimeFile];
  assert.ok(key, `${runtimeFile} has no registration key in check-build.mjs`);
  const runtimeCode = await readFile(resolve(output, runtimeFile), 'utf8');
  // `import()` evaluates the file as a module, which is always strict: compile and run it
  // strict here too, so sloppy-only code (implicit globals, `with`, octal) fails the build.
  const strictCode = `"use strict";${runtimeCode}`;
  // Compiling (not running) rejects static import/export and import.meta: the module must
  // be a single classic script, since `import()` of a sibling file fails under a dynamic URL.
  assert.doesNotThrow(
    () => new vm.Script(strictCode, { filename: runtimeFile }),
    `${runtimeFile} must be a single strict-mode script without static import/export or import.meta`,
  );
  assert.ok(!/\bimport\s*\(/.test(runtimeCode), `${runtimeFile} must not load other modules`);
  // A CSS `url(` in the module could pull a web accessible resource (or a font) by address:
  // styles stay self-contained. Case-sensitive on purpose, so `new URL(` is not caught.
  assert.ok(!runtimeCode.includes('url('), `${runtimeFile} must not contain a CSS url(`);
  const withoutShim = runtimeCode.replace(WXT_BROWSER_SHIM, '');
  assert.ok(
    !/chrome-extension:\/\/[a-p]{32}/.test(runtimeCode) &&
      !runtimeCode.includes('getURL') &&
      !/runtime\s*\??\.\s*id\b|runtime\s*\??\.?\s*\[\s*["'`]id["'`]/.test(withoutShim),
    `${runtimeFile} must not reference extension resource addresses or the extension ID`,
  );
  // Running it must register the factory (and nothing else it could not do in Node).
  const context = vm.createContext({ chrome: { runtime: {} }, browser: { runtime: {} } });
  vm.runInContext(strictCode, context, { filename: runtimeFile });
  assert.equal(
    // Read inside the context: symbol keys set on its global are not mirrored onto the sandbox object.
    vm.runInContext(`typeof globalThis[Symbol.for(${JSON.stringify(key)})]`, context),
    'function',
    `${runtimeFile} did not register its factory under ${key}`,
  );
}

// The full error copy table (src/lib/error-messages.ts) is background and extension-page
// only: content scripts show the `userMessage` the background attaches, plus a two-line
// local table (src/content/error-text.ts). These strings exist only in the full table.
const FULL_COPY_TABLE_MARKERS = ['OLLAMA_ORIGINS', '密钥格式不正确', '自定义服务已达 10 个上限'];
const contentFiles = [
  ...manifest.content_scripts.flatMap((script) => script.js ?? []),
  ...runtimeFiles,
];
for (const file of contentFiles) {
  const code = await readFile(resolve(output, file), 'utf8');
  for (const marker of FULL_COPY_TABLE_MARKERS) {
    assert.ok(
      !code.includes(marker),
      `${file} bundles the full error copy table (found "${marker}"); use src/content/error-text.ts`,
    );
  }
}

// The phonetic tables (src/lib/phonetic/lookup.ts) are read by the background only, shard by
// shard: packaged with their sources and licenses, and never web accessible.
const PHONETIC_DIRS = ['dict/gb', 'dict/us'];
const PHONETIC_FILES = [
  'dict/SOURCES.txt',
  'dict/ECDICT-LICENSE.txt',
  'dict/ipa-dict-LICENSE.txt',
  'dict/cmudict-ipa-LICENSE.txt',
  'dict/CMUdict-LICENSE.txt',
];
for (const dir of PHONETIC_DIRS) {
  const shards = (await readdir(resolve(output, dir))).filter((name) => name.endsWith('.tsv'));
  assert.ok(shards.length > 0, `${dir} has no shards`);
}
assert.match(
  await readFile(resolve(output, 'dict/SOURCES.txt'), 'utf8'),
  /^# phonetic tables · build-phonetics v\d+\n/,
  'dict/SOURCES.txt must start with its "# phonetic tables · build-phonetics <version>" line',
);
assert.ok(
  !manifest.web_accessible_resources.some((entry) =>
    entry.resources.some((resource) => resource.startsWith('dict/') || resource.includes('*')),
  ),
  'No phonetic table may be a web accessible resource',
);

const files = [
  ...PHONETIC_FILES,
  ...runtimeFiles,
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons ?? {}),
  ...manifest.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
];
await Promise.all(files.map((file) => access(resolve(output, file))));
console.log(`MV3 build verified: ${files.length} manifest file references exist.`);
