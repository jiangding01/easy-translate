import { describe, expect, it } from 'vitest';
import { type Harness, launch, trackTests, type UiLocale, waitFor } from './harness';
import { type Ok, type PageState, prepare } from './support';

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
      // The panel has no activeTab here (the popup is opened by the worker, not a click), so
      // it reports a page it cannot read; that state and its Settings button are stable.
      // Wait for that state itself: on the way the panel shows text too ("loading", then
      // "reading the page"), so "the root has content" can be read too early.
      const body = await waitFor(
        async () => {
          const text = await popup.evaluate<string>('document.body.innerText');
          if (!text.includes(copy.blocked)) throw new Error(`panel text ${JSON.stringify(text)}`);
          return text;
        },
        { message: 'the panel to report a page it cannot read' },
      );
      expect(body).toContain(copy.panel);
      harness.assertNoErrors();
    },
  );

  it('shows the page it was opened for and translates it from the button', async () => {
    const harness = await start('en');
    await harness.openPage('e2e-article.html');
    const { origin, host } = await harness.evaluate<{ origin: string; host: string }>(
      '({ origin: location.origin, host: location.host })',
    );
    // As a plain tab the panel has no "active tab" of its own: both extension API objects
    // answer tabs.query with the test page (wxt picks whichever one exists).
    const tab = { id: harness.tabId, url: `${origin}/e2e-article.html`, active: true, windowId: 1 };
    const preload = `for (const api of [globalThis.browser, globalThis.chrome]) {
      if (api?.tabs) api.tabs.query = async () => [${JSON.stringify(tab)}];
    }`;
    const popup = await harness.extPage('popup.html', { preload });
    try {
      const button = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Translate this page'))`;
      await waitFor(
        async () =>
          (await popup.evaluate<string>('document.body.innerText')).includes(host) &&
          (await popup.evaluate<boolean>(`!!(${button})`)),
        { message: 'the panel to show the test page and its translate button' },
      );
      await popup.evaluate(`(${button}).click()`);
      await waitFor(
        async () => (await harness.tell<Ok<PageState>>('page.getState')).data.translated >= 8,
        { message: 'the test page to be translated from the panel' },
      );
      expect(harness.google.count).toBeGreaterThan(0);
      harness.assertNoErrors();
    } finally {
      // The panel closes itself once translation starts.
      await popup.close();
    }
  });
});
