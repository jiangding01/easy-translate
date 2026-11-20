// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createDefaultConfig } from '@/lib/config/defaults';
import type { ConfigChange, HoldKey } from '@/lib/config/types';
import { createGetMessage, loadLocales } from '../../../scripts/i18n-messages.mjs';
import { HoldKeyRow, holdKeyLabel, isMac } from './GeneralPage';

// The "hold to translate" row of the settings page (M3b plan, section 6).

async function useEnglish() {
  const getMessage = createGetMessage(await loadLocales(), 'en');
  fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage;
}

const row = (holdKey: HoldKey, mac: boolean, change = vi.fn()) =>
  createElement(HoldKeyRow, { holdKey, mac, change });

function parse(html: string) {
  const host = new DOMParser().parseFromString(html, 'text/html').body;
  const segments = [...host.querySelectorAll('label')];
  return {
    labels: segments.map((label) => label.textContent),
    checked: segments.map((label) => (label.querySelector('input') as HTMLInputElement).checked),
    name: host.querySelector('#hold-label')?.textContent,
    group: host.querySelector('fieldset')?.getAttribute('aria-labelledby'),
  };
}

describe('isMac', () => {
  it('tells macOS from Windows and Linux by the platform string', () => {
    expect(isMac({ platform: 'MacIntel' })).toBe(true);
    expect(isMac({ platform: 'Win32' })).toBe(false);
    expect(isMac({ platform: 'Linux x86_64' })).toBe(false);
  });
});

describe('holdKeyLabel', () => {
  it('names the keys as macOS prints them, and as Windows and Linux do', () => {
    expect(holdKeyLabel('ctrl', true)).toBe('⌃ Control');
    expect(holdKeyLabel('alt', true)).toBe('⌥ Option');
    expect(holdKeyLabel('ctrl', false)).toBe('Ctrl');
    expect(holdKeyLabel('alt', false)).toBe('Alt');
  });

  it('says off in the UI language', async () => {
    expect(holdKeyLabel('off', true)).toBe('关');
    await useEnglish();
    expect(holdKeyLabel('off', false)).toBe('Off');
  });
});

describe('HoldKeyRow', () => {
  let root: ReturnType<typeof createRoot> | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = '';
  });

  it('draws three choices with the default (Ctrl) selected', () => {
    const view = parse(renderToStaticMarkup(row(createDefaultConfig('zh-CN').page.holdKey, true)));
    expect(view.name).toBe('按住翻译段落');
    expect(view.group).toBe('hold-label');
    expect(view.labels).toEqual(['⌃ Control', '⌥ Option', '关']);
    expect(view.checked).toEqual([true, false, false]);
  });

  it('uses the Windows and Linux key names off macOS', () => {
    const view = parse(renderToStaticMarkup(row('off', false)));
    expect(view.labels).toEqual(['Ctrl', 'Alt', '关']);
    expect(view.checked).toEqual([false, false, true]);
  });

  it('writes page.holdKey when a choice is clicked', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const change = vi.fn<(next: ConfigChange) => void>();
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    act(() => root?.render(row('ctrl', false, change)));
    const inputs = host.querySelectorAll('input');
    act(() => inputs[1]?.click());
    expect(change).toHaveBeenLastCalledWith({ path: 'page.holdKey', value: 'alt' });
    act(() => inputs[2]?.click());
    expect(change).toHaveBeenLastCalledWith({ path: 'page.holdKey', value: 'off' });
  });
});
