import { z } from 'zod';
import { LANGUAGE_CODES } from '@/lib/languages';
import {
  type ConfigV1,
  CUSTOM_PROVIDER_ID_PATTERN,
  CUSTOM_PROVIDER_LIMITS,
  type Engine,
  isBuiltinEngine,
  isEngineId,
  MAX_CUSTOM_PROVIDERS,
  THEMES,
} from './types';

const customProviderSchema = z.looseObject({
  name: z.string().max(CUSTOM_PROVIDER_LIMITS.name),
  baseURL: z.string().max(CUSTOM_PROVIDER_LIMITS.baseURL),
  model: z.string().max(CUSTOM_PROVIDER_LIMITS.model),
});

// Background-only: the client never imports zod.
// Objects are loose so keys written by a newer build survive a downgrade.
export const configSchema = z
  .looseObject({
    ui: z.looseObject({
      theme: z.enum(THEMES),
    }),
    language: z.looseObject({
      target: z.enum(LANGUAGE_CODES),
      source: z.enum(['auto', ...LANGUAGE_CODES]),
    }),
    translation: z.looseObject({
      engine: z.custom<Engine>(isEngineId, { message: 'Unknown engine' }),
    }),
    providers: z.looseObject({
      openai: z.looseObject({ baseURL: z.string(), model: z.string() }),
      deepseek: z.looseObject({ model: z.string() }),
      gemini: z.looseObject({ model: z.string() }),
    }),
    customProviders: z
      .record(z.string().regex(CUSTOM_PROVIDER_ID_PATTERN), customProviderSchema)
      .refine((providers) => Object.keys(providers).length <= MAX_CUSTOM_PROVIDERS, {
        message: `At most ${MAX_CUSTOM_PROVIDERS} custom providers`,
      }),
  })
  // Runs only once the shape is valid: the default engine must exist.
  .superRefine((config, ctx) => {
    const { engine } = config.translation;
    if (!isBuiltinEngine(engine) && !Object.hasOwn(config.customProviders, engine)) {
      ctx.addIssue({
        code: 'custom',
        path: ['translation', 'engine'],
        message: 'Engine refers to a missing custom provider',
      });
    }
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
