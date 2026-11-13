import type { LanguageCode } from '@/lib/languages';

// Pure types and constants: safe to import from any context (no zod).

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const CONFIG_SCHEMA_VERSION = 1;
export const CONFIG_STORAGE_KEY = 'config';

export interface ConfigV1 {
  ui: { theme: Theme };
  language: { target: LanguageCode };
}

export interface ConfigSnapshot {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  data: ConfigV1;
}

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** Paths stop at leaves, arrays and records: those are replaced as a whole. */
type StopsHere<T> = T extends Primitive
  ? true
  : T extends readonly unknown[]
    ? true
    : string extends keyof T
      ? true
      : false;

export type DotPath<T, Prefix extends string = ''> = {
  [K in keyof T & string]: StopsHere<NonNullable<T[K]>> extends true
    ? `${Prefix}${K}`
    : DotPath<NonNullable<T[K]>, `${Prefix}${K}.`>;
}[keyof T & string];

export type PathValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? PathValue<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

export type ConfigPath = DotPath<ConfigV1>;

export type ConfigChange = {
  [P in ConfigPath]: { path: P; value: PathValue<ConfigV1, P> };
}[ConfigPath];
