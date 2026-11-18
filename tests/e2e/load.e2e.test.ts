import { describe, expect, it } from 'vitest';
import { type Harness, type LaunchOptions, launch, trackTests } from './harness';

// P0-1: the extension loads in each interface language and its service worker reads the
// matching locale. `raw` loads the unchanged build with --lang, the real fallback path
// (Chrome honours --lang on Linux only).

let h: Harness | undefined;
trackTests(() => h, { closeAfterEach: true });

async function brandName(options: LaunchOptions): Promise<string> {
  h = undefined;
  h = await launch(options);
  return h.sw<string>(`chrome.i18n.getMessage('manifest_name')`);
}

describe('extension load', () => {
  it.each([
    ['en', 'Islet Translate'],
    ['zh_CN', '译屿'],
    ['zh_TW', '譯嶼'],
  ] as const)('ui %s names the extension %s', async (ui, name) => {
    expect(await brandName({ ui })).toBe(name);
    h?.assertNoErrors();
  });

  it.runIf(process.platform === 'linux').each([
    ['zh-CN', '译屿'],
    ['zh-TW', '譯嶼'],
  ])('unchanged build with --lang=%s names the extension %s', async (lang, name) => {
    expect(await brandName({ raw: true, lang })).toBe(name);
    h?.assertNoErrors();
  });
});
