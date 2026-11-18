// README and store screenshots: load the built extension into a headless Chrome for Testing,
// open a demo article, drive the extension over CDP, and save PNGs.
//
//   npm run build
//   node scripts/screenshots/shoot.mjs --ui en --article zh --target en --word 每一次打断都有代价。
//   node scripts/screenshots/shoot.mjs --ui zh_CN --article en
//
// Each README shows its own interface language, translating from the other language.
//
// --ui       locale folder of the interface (en, zh_CN); the copy keeps only that locale, so the
//            browser's own language does not matter
// --article  demo article (article-<name>.html next to this file)
// --target   target language to set first (default: the extension's default for --ui)
// --shots    any of page, page-isle, isle, only, card, options
// --word     word to select for the card shot (in --article)
// --prefix   file name prefix (default: en for en, zh for zh_CN)
// --out      output folder (default docs/assets/readme)
// CHROME     path to the browser; defaults to the newest Playwright Chrome for Testing
//
// A manual tool, not a check: shots use a live translation engine, so the text can vary.

import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const { values: args } = parseArgs({
  options: {
    ui: { type: 'string', default: 'en' },
    article: { type: 'string', default: 'en' },
    target: { type: 'string' },
    shots: { type: 'string', default: 'page-isle,isle,only,card,options' },
    word: { type: 'string', default: 'serendipity' },
    prefix: { type: 'string' },
    out: { type: 'string', default: 'docs/assets/readme' },
    ext: { type: 'string', default: '.output/chrome-mv3' },
  },
});

const SHOTS = new Set(['page', 'page-isle', 'isle', 'only', 'card', 'options']);
const shots = new Set(args.shots.split(',').map((s) => s.trim()));
const prefix = args.prefix ?? ({ en: 'en', zh_CN: 'zh' }[args.ui] || args.ui);
const outDir = resolve(root, args.out);
const articleFile = join(here, `article-${args.article}.html`);
/** Every shot is at 2x, so it stays sharp on high-density screens. */
const SCALE = 2;
const VIEW = { width: 1100, height: 760 };
const OPTIONS_VIEW = { width: 1100, height: 1000 };

/** Stops the run; `main` still closes the browser and removes its temporary folders. */
function fail(message) {
  throw Object.assign(new Error(message), { expected: true });
}

function findChrome() {
  if (process.env.CHROME) {
    if (!existsSync(process.env.CHROME)) fail(`no browser at CHROME=${process.env.CHROME}`);
    return process.env.CHROME;
  }
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const builds = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    : [];
  for (const build of builds) {
    for (const arch of ['chrome-mac-arm64', 'chrome-mac']) {
      const app = join(
        cache,
        build,
        arch,
        'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      );
      if (existsSync(app)) return app;
    }
  }
  fail('no Chrome for Testing found; set CHROME=/path/to/chrome');
}

/** A copy of the build that only knows the --ui locale. */
function prepareExtension() {
  const built = resolve(root, args.ext);
  if (!existsSync(join(built, 'manifest.json'))) fail(`no build at ${built}; run npm run build`);
  if (!existsSync(join(built, '_locales', args.ui))) fail(`the build has no _locales/${args.ui}`);
  const dir = mkdtempSync(join(tmpdir(), 'et-shots-ext-'));
  cpSync(built, dir, { recursive: true });
  for (const locale of readdirSync(join(dir, '_locales'))) {
    if (locale !== args.ui) rmSync(join(dir, '_locales', locale), { recursive: true });
  }
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.default_locale = args.ui;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return dir;
}

/** Serves the demo articles in this folder, and nothing else. */
async function serveArticles() {
  const server = createServer((req, res) => {
    const name = /^\/(article-[a-z]+\.html)$/.exec(req.url ?? '')?.[1];
    const file = name && join(here, name);
    if (!file || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return server;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((done, reject) => {
    ws.onopen = done;
    ws.onerror = reject;
  });
  let next = 0;
  const waiting = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  };
  return {
    send: (method, params = {}) =>
      new Promise((done) => {
        const id = ++next;
        waiting.set(id, done);
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function evaluate(target, expression) {
  const reply = await target.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const details = reply.result?.exceptionDetails;
  if (details) throw new Error(details.exception?.description ?? details.text);
  return reply.result?.result?.value;
}

async function main() {
  for (const name of shots) if (!SHOTS.has(name)) fail(`unknown shot "${name}"`);
  if (!existsSync(articleFile)) fail(`no article at ${articleFile}`);
  const chromePath = findChrome();
  mkdirSync(outDir, { recursive: true });
  const extDir = prepareExtension();
  const server = await serveArticles();
  const articleURL = `http://127.0.0.1:${server.address().port}/article-${args.article}.html`;
  const port = 9300 + Math.floor(Math.random() * 500);
  const profileDir = mkdtempSync(join(tmpdir(), 'et-shots-profile-'));
  const chrome = spawn(
    chromePath,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      `--load-extension=${extDir}`,
      `--disable-extensions-except=${extDir}`,
      '--use-mock-keychain',
      '--password-store=basic',
      '--headless=new',
      '--no-first-run',
      '--hide-scrollbars',
    ],
    { stdio: 'ignore' },
  );
  let launchError;
  chrome.once('error', (error) => {
    launchError = error;
  });
  const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();

  try {
    // Our service worker: other built-in workers can show up first, some without `chrome`.
    let worker;
    let extensionId;
    for (let i = 0; i < 100 && !worker && !launchError; i++) {
      await sleep(200);
      const targets = await list().catch(() => []);
      for (const t of targets.filter((x) => x.type === 'service_worker')) {
        const candidate = await connect(t.webSocketDebuggerUrl).catch(() => null);
        if (!candidate) continue;
        const ours = await evaluate(
          candidate,
          `typeof chrome !== 'undefined' && !!chrome.runtime?.getManifest && JSON.stringify(chrome.runtime.getManifest().web_accessible_resources ?? []).includes('page-runtime.js')`,
        ).catch(() => false);
        if (ours) {
          worker = candidate;
          extensionId = new URL(t.url).host;
          break;
        }
        candidate.close();
      }
    }
    if (launchError) fail(`could not start the browser: ${launchError.message}`);
    if (!worker) fail('the extension did not start');

    const pageTarget = (await list()).find((t) => t.type === 'page');
    const page = await connect(pageTarget.webSocketDebuggerUrl);
    const viewport = (view) =>
      page.send('Emulation.setDeviceMetricsOverride', {
        ...view,
        deviceScaleFactor: SCALE,
        mobile: false,
      });
    const navigate = async (url) => {
      await page.send('Page.navigate', { url });
      await sleep(1500);
    };
    const save = async (name, clip) => {
      const reply = await page.send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip: { ...clip, scale: SCALE } } : {}),
      });
      const file = join(outDir, `${prefix}-${name}.png`);
      writeFileSync(file, Buffer.from(reply.result.data, 'base64'));
      console.log('saved', file);
    };
    const hover = async (x, y) => {
      for (const dy of [0, 1, 2, 3]) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y + dy });
        await sleep(120);
      }
    };
    // The content scripts' messaging (webext-core) format, sent to the top frame.
    const tell = (type, data) =>
      evaluate(
        worker,
        `(async () => {
          const [tab] = await chrome.tabs.query({ active: true });
          return chrome.tabs.sendMessage(tab.id, { id: Date.now(), type: ${JSON.stringify(type)}, data: ${JSON.stringify(data ?? null)}, timestamp: Date.now() }, { frameId: 0 });
        })()`,
      );
    const isleRect = async () => {
      const value = await evaluate(
        page,
        `document.documentElement.querySelector('et-isle')?.getAttribute('data-et-rect') ?? ''`,
      );
      const [x, y, width, height] = value.split(',').map(Number);
      return value ? { x, y, width, height } : null;
    };

    await viewport(VIEW);

    if (args.target) {
      // config.patch is for extension pages only, so send it from the settings page.
      await navigate(`chrome-extension://${extensionId}/options.html`);
      const reply = await evaluate(
        page,
        `chrome.runtime.sendMessage({ id: Date.now(), type: 'config.patch', data: [{ path: 'language.target', value: ${JSON.stringify(args.target)} }], timestamp: Date.now() })`,
      );
      if (!reply || reply.err || reply.res?.ok === false) {
        fail(`could not set the target language: ${JSON.stringify(reply)}`);
      }
    }

    if (['page', 'page-isle', 'isle', 'only'].some((s) => shots.has(s))) {
      await navigate(articleURL);
      await tell('page.toggle');
      // Wait until the translations stop arriving.
      let count = -1;
      for (let i = 0, stable = 0; i < 60 && stable < 3; i++) {
        await sleep(500);
        const now = await evaluate(page, `document.querySelectorAll('et-tr').length`);
        stable = now > 0 && now === count ? stable + 1 : 0;
        count = now;
      }
      if (count <= 0) fail('nothing was translated');
      await sleep(800);
      if (shots.has('page')) await save('page');

      if (shots.has('page-isle') || shots.has('isle')) {
        const dot = await isleRect();
        if (!dot) fail('the control bar did not appear');
        await hover(dot.x + dot.width / 2, dot.y + dot.height / 2);
        await sleep(1000);
        if (shots.has('page-isle')) await save('page-isle');
        const open = await isleRect();
        if (shots.has('isle') && open) {
          // Room for the shadow and the side the tips open towards.
          const pad = 24;
          const x = Math.max(0, open.x - 220);
          const y = Math.max(0, open.y - pad);
          await save('isle', {
            x,
            y,
            width: Math.min(VIEW.width, open.x + open.width + pad) - x,
            height: Math.min(VIEW.height, open.y + open.height + pad) - y,
          });
        }
        await hover(300, 120);
        await sleep(800);
      }

      if (shots.has('only')) {
        await tell('page.setMode', 'translation');
        await sleep(1500);
        await save('only');
        await tell('page.setMode', 'bilingual');
        await sleep(800);
      }
    }

    if (shots.has('card')) {
      await navigate(articleURL);
      const selected = await evaluate(
        page,
        `(() => {
          const word = ${JSON.stringify(args.word)};
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const at = node.data.indexOf(word);
            if (at < 0) continue;
            node.parentElement.scrollIntoView({ block: 'center' });
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + word.length);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            return getSelection().toString();
          }
          return '';
        })()`,
      );
      if (!selected) fail(`"${args.word}" is not in article-${args.article}.html`);
      // As the context menu does: with the text, the card does not depend on the page having
      // the focus, which a headless page may not.
      await tell('selection.open', { selectionText: selected, frameId: 0 });
      await sleep(5000);
      await save('card');
    }

    if (shots.has('options')) {
      await viewport(OPTIONS_VIEW);
      await navigate(`chrome-extension://${extensionId}/options.html`);
      // Section names come from the interface locale's own copy, so match by position.
      const sections = await evaluate(
        page,
        `[...document.querySelectorAll('nav button, nav a, [role=tab]')].map((b) => b.textContent.trim())`,
      );
      for (const [name, index] of [
        ['options-general', 0],
        ['options-services', 1],
      ]) {
        await evaluate(
          page,
          `[...document.querySelectorAll('nav button, nav a, [role=tab]')][${index}]?.click()`,
        );
        await sleep(900);
        console.log(`${name}: ${sections[index]}`);
        await save(name);
      }
    }
  } finally {
    const exited = new Promise((done) => chrome.once('exit', done));
    chrome.kill('SIGTERM');
    await Promise.race([exited, sleep(5000)]);
    server.close();
    rmSync(extDir, { recursive: true, force: true });
    rmSync(profileDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`shoot: ${error.expected ? error.message : error.stack}`);
  process.exitCode = 1;
}
