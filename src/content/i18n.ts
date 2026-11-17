import { browser } from 'wxt/browser';
import type { GeneratedI18nStructure } from '#i18n';

// UI copy for the on-demand content modules (page-runtime, selection-runtime), which must
// not bundle @wxt-dev/i18n: a thin typed wrapper over `browser.i18n.getMessage`. Extension
// pages and the background use `i18n.t` from '#i18n'. Never call these at module top level:
// evaluating an on-demand module only registers its factory, and check-build runs it where
// `i18n` does not exist (docs/plans/i18n.md 4.1–4.2). Keep key tables (typed `NoArgKey`) at
// top level and look the copy up inside functions. Resident content scripts do not import
// this file at all (4.3).

/** What `wxt prepare` generates from en.yml: key → `{ substitutions, plural, … }`. */
type Structure = GeneratedI18nStructure;
type Entry = { substitutions: number; plural: boolean };

/** Keys usable here: no Chrome predefined (`@@…`) message and no `{name}` substitution. */
type ContentKey<S> = {
  [K in Extract<keyof S, string>]: K extends `@@${string}`
    ? never
    : S[K] extends { namedSubstitutions: readonly string[] }
      ? never
      : K;
}[Extract<keyof S, string>];

type KeyWhere<S, Shape> = {
  [K in ContentKey<S>]: S[K] extends Shape ? K : never;
}[ContentKey<S>];

/** Plain messages (`message`). */
export type MessageKey<S = Structure> = KeyWhere<S, { plural: false }>;
/** Plain messages without substitutions: the only keys a table or a union may hold. */
export type NoArgKey<S = Structure> = KeyWhere<S, { plural: false; substitutions: 0 }>;
/** Plural messages (`pluralMessage`). */
export type PluralKey<S = Structure> = KeyWhere<S, { plural: true }>;

/** N strings (at most 9, Chrome's limit); any number of them when N is unknown. */
type Strings<N extends number, Acc extends string[] = []> = [N] extends [never]
  ? string[]
  : Acc['length'] extends N | 9
    ? Acc
    : Strings<N, [...Acc, string]>;

/** `$1`…`$9` of a key, as strings (format numbers before passing them). */
type Substitutions<S, K extends keyof S> = S[K] extends Entry ? Strings<S[K]['substitutions']> : [];

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
/** Rejects a union of keys: their substitutions could not be checked against each one. */
type Single<K> = true extends IsUnion<K> ? never : unknown;

export interface MessageFn<S = Structure> {
  /** A key without substitutions; a union of such keys too (e.g. from a key table). */
  <K extends NoArgKey<S>>(key: K): string;
  /** A key with `$1`…`$9`, named as a single literal so its substitutions can be checked. */
  <K extends MessageKey<S>>(key: K & Single<K>, ...substitutions: Substitutions<S, K>): string;
}

/**
 * The form for `count`. `$1` is the count itself unless substitutions are given (pass a
 * formatted count, e.g. "1,234", that way).
 */
export type PluralFn<S = Structure> = <K extends PluralKey<S>>(
  key: K & Single<K>,
  count: number,
  // `count` stands in for `$1` only: a key with `$2` and up needs all its substitutions.
  ...substitutions: S[K] extends { substitutions: 0 | 1 }
    ? [] | Substitutions<S, K>
    : Substitutions<S, K>
) => string;

function lookup(key: string, substitutions: readonly string[]): string {
  // WXT types `getMessage` from public/_locales only; these keys come from src/locales.
  const getMessage = browser.i18n.getMessage as (name: string, substitutions?: string[]) => string;
  return getMessage(key.replaceAll('.', '_'), [...substitutions]);
}

/** The copy for `key`, with its `$1`…`$9` filled in. */
export const message: MessageFn = (key: string, ...substitutions: string[]) =>
  lookup(key, substitutions);

/** The plural form of `key` for `count`. */
export const pluralMessage: PluralFn = (key: string, count: number, ...substitutions: string[]) =>
  pickPlural(lookup(key, substitutions.length > 0 ? substitutions : [String(count)]), count);

/**
 * @wxt-dev/i18n joins a plural's forms with " | " at build time (`1 | n` or `0 | 1 | n`);
 * `i18n.t` picks one at run time, and so must we: `getMessage` returns them all.
 */
export function pickPlural(text: string, count: number): string {
  const forms = text.split(' | ');
  if (forms.length === 2) return forms[count === 1 ? 0 : 1] ?? text;
  if (forms.length === 3) return forms[count === 0 || count === 1 ? count : 2] ?? text;
  return text;
}
