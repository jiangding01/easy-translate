import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
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
assert.equal(manifest.minimum_chrome_version, '130');
assert.deepEqual(
  manifest.commands?.['translate-page']?.suggested_key,
  { default: 'Alt+A', mac: 'MacCtrl+Shift+A' },
  'Missing or changed translate-page shortcut',
);

// The on-demand page runtime: the one web accessible resource, reachable only by
// the content script through a dynamic URL.
assert.deepEqual(
  manifest.web_accessible_resources,
  [
    {
      resources: ['page-runtime.js'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    },
  ],
  'Missing or changed web_accessible_resources',
);

// Keep in sync with PAGE_RUNTIME_KEY in src/content/runtime-contract.ts.
const PAGE_RUNTIME_KEY = 'easy-translate.page-runtime';
const runtimeFile = 'page-runtime.js';
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
// The one allowed read of the extension ID: wxt/browser picking `browser` or `chrome`.
// If WXT rewrites this shim the check fails loudly; inspect the new form before exempting it.
const WXT_BROWSER_SHIM = 'globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome';
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
  vm.runInContext(`typeof globalThis[Symbol.for(${JSON.stringify(PAGE_RUNTIME_KEY)})]`, context),
  'function',
  `${runtimeFile} did not register the page runtime factory`,
);

const files = [
  runtimeFile,
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons ?? {}),
  ...manifest.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
];
await Promise.all(files.map((file) => access(resolve(output, file))));
console.log(`MV3 build verified: ${files.length} manifest file references exist.`);
