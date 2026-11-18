// Finds a Chrome for Testing: branded Chrome 137+ ignores --load-extension.
// Order: the CHROME environment variable, then the newest build in the Playwright cache.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Executables inside a Playwright chromium-<build> folder, per platform. */
const BINARIES = [
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
];

function playwrightCache() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  return process.platform === 'darwin'
    ? join(homedir(), 'Library/Caches/ms-playwright')
    : join(homedir(), '.cache/ms-playwright');
}

/** The browser path; throws with a hint when there is none. */
export function findChrome() {
  if (process.env.CHROME) {
    if (!existsSync(process.env.CHROME)) {
      throw new Error(`no browser at CHROME=${process.env.CHROME}`);
    }
    return process.env.CHROME;
  }
  const cache = playwrightCache();
  const builds = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    : [];
  for (const build of builds) {
    for (const binary of BINARIES) {
      const path = join(cache, build, binary);
      if (existsSync(path)) return path;
    }
  }
  throw new Error('no Chrome for Testing found; set CHROME=/path/to/chrome');
}
