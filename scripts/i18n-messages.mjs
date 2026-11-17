// Locale files as the extension sees them: parsed and converted by @wxt-dev/i18n/build (the
// same code the build runs), plus Chrome's `getMessage` rules for the unit-test stub.
// Shared by scripts/check-i18n.mjs and vitest.setup.ts.
import { readdir } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateChromeMessages, parseMessagesFile } from '@wxt-dev/i18n/build';

// Path arithmetic, not `new URL(…)`: under happy-dom, tests see the DOM's URL.
export const LOCALES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/locales');
export const DEFAULT_LOCALE = 'en';

/** `zh_CN.yml` → `zh_CN` (the `_locales` folder name). */
export function localeOf(file) {
  return basename(file, extname(file));
}

/** Every locale file in `dir`: `{ locale, file, messages }`, messages as @wxt-dev/i18n parses them. */
export async function loadLocales(dir = LOCALES_DIR) {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.yml')).sort();
  return Promise.all(
    names.map(async (name) => {
      const file = resolve(dir, name);
      return { locale: localeOf(file), file, messages: await parseMessagesFile(file) };
    }),
  );
}

/** `{ lowercased message name: text }`, as in `_locales/<locale>/messages.json`. */
export function chromeMessages(messages) {
  const table = {};
  for (const [name, entry] of Object.entries(generateChromeMessages(messages))) {
    table[name.toLowerCase()] = entry.message;
  }
  return table;
}

/**
 * Chrome's substitution: `$$` is a dollar sign, `$1`…`$9` take the substitutions (a missing
 * one becomes empty). Checked against Chrome for Testing 158 (docs/plans/i18n.md).
 */
export function substitute(text, substitutions = []) {
  const list = typeof substitutions === 'string' ? [substitutions] : substitutions;
  return text.replace(/\$(\$|[1-9])/g, (_, token) =>
    token === '$' ? '$' : String(list[Number(token) - 1] ?? ''),
  );
}

const RTL = new Set(['ar', 'fa', 'he', 'ur']);

/** Chrome's predefined `@@…` messages as a browser in `locale` answers them. */
export function predefinedMessages(locale) {
  const rtl = RTL.has(locale.split(/[-_]/)[0]);
  return {
    '@@ui_locale': locale,
    '@@extension_id': 'abcdefghijklmnopabcdefghijklmnop',
    '@@bidi_dir': rtl ? 'rtl' : 'ltr',
    '@@bidi_reversed_dir': rtl ? 'ltr' : 'rtl',
    '@@bidi_start_edge': rtl ? 'right' : 'left',
    '@@bidi_end_edge': rtl ? 'left' : 'right',
  };
}

/**
 * A `browser.i18n.getMessage` for unit tests: the predefined `@@…` messages for `locale`, then
 * `locale`, then the default locale (as Chrome falls back), names case-insensitive. An unknown name throws instead of returning
 * "" so a missing key fails the test that hits it.
 */
export function createGetMessage(locales, locale, defaultLocale = DEFAULT_LOCALE) {
  const tables = new Map(locales.map((entry) => [entry.locale, chromeMessages(entry.messages)]));
  const order = [predefinedMessages(locale), tables.get(locale), tables.get(defaultLocale)];
  if (!tables.has(locale) && !tables.has(defaultLocale)) {
    throw new Error(`No messages for ${locale} or ${defaultLocale}`);
  }
  return (name, substitutions) => {
    const key = String(name).toLowerCase();
    const table = order.find((candidate) => candidate && Object.hasOwn(candidate, key));
    if (!table) throw new Error(`i18n: no message "${name}" in ${locale} or ${defaultLocale}`);
    return substitute(table[key], substitutions);
  };
}
