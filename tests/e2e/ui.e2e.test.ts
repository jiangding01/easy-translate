import { describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, type UiLocale, waitFor } from './harness';
import { prepare } from './support';

// P0-7 (settings page) and P0-8 (action panel): rendered in the real extension, in the
// interface language the build was forced to.

let h: Harness | undefined;
trackTests(() => h, { closeAfterEach: true });

const COPY = {
  en: {
    brand: 'Islet Translate',
    title: 'Islet Translate · Settings',
    general: 'General',
    services: 'Translation services',
    panel: 'Settings',
    blocked: "This page can't be translated",
  },
  zh_TW: {
    brand: '譯嶼',
    title: '譯嶼 · 設定',
    general: '一般',
    services: '翻譯服務',
    panel: '設定',
    blocked: '這個頁面無法翻譯',
  },
} as const;

async function start(ui: UiLocale) {
  // Not the previous (closed) browser: a failed launch must not save its stale artifacts.
  h = undefined;
  h = await launch({ ui });
  await prepare(h);
  return h;
}

describe('settings page', () => {
  it.each(['en', 'zh_TW'] as const)(
    'switches pages and follows the interface language (%s)',
    async (ui) => {
      const copy = COPY[ui];
      const page = await (await start(ui)).extPage('options.html');
      const text = (selector: string) =>
        page.evaluate<string>(
          `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`,
        );

      // The page opens on the services tab; the brand and the tab title use the UI language.
      await waitFor(async () => (await text('h1')) === copy.services, {
        message: 'the services page',
      });
      expect(await page.evaluate<string>('document.title')).toBe(copy.title);
      expect(await text('nav img + span')).toBe(copy.brand);
      expect(await text('nav a[aria-current="page"]')).toBe(copy.services);

      await page.evaluate(`document.querySelector('nav a[href="#general"]').click()`);
      await waitFor(async () => (await text('h1')) === copy.general, {
        message: 'the general page',
      });
      expect(await text('nav a[aria-current="page"]')).toBe(copy.general);

      await page.evaluate(`document.querySelector('nav a[href="#services"]').click()`);
      await waitFor(async () => (await text('h1')) === copy.services, {
        message: 'the services page again',
      });
      h?.assertNoErrors();
    },
  );

  it('tests the Google connection and shows the mock translation', async () => {
    const page = await (await start('en')).extPage('options.html');
    // The default engine's panel is open: its test button and the live result.
    await waitFor(
      () =>
        page.evaluate(
          `[...document.querySelectorAll('button')].some((b) => b.textContent === 'Test connection')`,
        ),
      { message: 'the test button' },
    );
    await page.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent === 'Test connection').click()`,
    );
    await waitFor(
      () =>
        page.evaluate<boolean>(
          `[...document.querySelectorAll('[role="status"]')].some((el) => el.textContent.includes('【MOCK】HELLO, WORLD.'))`,
        ),
      { message: 'the translated test sentence' },
    );
    expect(h?.google.count).toBeGreaterThan(0);
    h?.assertNoErrors();
  });
});

describe('action panel', () => {
  it.each(['en', 'zh_TW'] as const)(
    'opens, renders and follows the interface language (%s)',
    async (ui) => {
      const harness = await start(ui);
      const copy = COPY[ui];
      await harness.openPage('e2e-article.html');
      await harness.sw('chrome.action.openPopup()');
      const popup = await harness.waitForExtPage('popup.html');
      // Rendered: the React root has content, in the interface language.
      await waitFor(
        () => popup.evaluate<boolean>(`document.querySelector('#root')?.textContent.length > 0`),
        {
          message: 'the panel to render',
        },
      );
      // The panel has no activeTab here (the popup is opened by the worker, not a click), so
      // it reports a page it cannot read; that state and its Settings button are stable.
      const body = await popup.evaluate<string>('document.body.innerText');
      expect(body).toContain(copy.blocked);
      expect(body).toContain(copy.panel);
      harness.assertNoErrors();
    },
  );
});
