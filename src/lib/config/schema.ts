import { z } from 'zod';
import { LANGUAGE_CODES } from '@/lib/languages';
import { type ConfigV1, ENGINES, THEMES } from './types';

// Background-only: the client never imports zod.
// Objects are loose so keys written by a newer build survive a downgrade.
export const configSchema = z.looseObject({
  ui: z.looseObject({
    theme: z.enum(THEMES),
  }),
  language: z.looseObject({
    target: z.enum(LANGUAGE_CODES),
    source: z.enum(['auto', ...LANGUAGE_CODES]),
  }),
  translation: z.looseObject({
    engine: z.enum(ENGINES),
  }),
  providers: z.looseObject({
    openai: z.looseObject({ baseURL: z.string(), model: z.string() }),
    deepseek: z.looseObject({ model: z.string() }),
    gemini: z.looseObject({ model: z.string() }),
    custom: z.looseObject({ baseURL: z.string(), model: z.string() }),
  }),
});

export type ConfigSchema = typeof configSchema;

// Compile-time only (type position, nothing emitted): the schema output must
// match ConfigV1. looseObject adds an index signature, so compare known keys only.
type StripIndex<T> = T extends object
  ? { [K in keyof T as string extends K ? never : K]: StripIndex<T[K]> }
  : T;
type SchemaOutput = StripIndex<z.output<typeof configSchema>>;
type Assert<T extends true> = T;
export type ConfigSchemaMatchesType = Assert<
  [SchemaOutput] extends [ConfigV1] ? ([ConfigV1] extends [SchemaOutput] ? true : false) : false
>;
