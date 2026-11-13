import { z } from 'zod';
import { LANGUAGE_CODES } from '@/lib/languages';
import { THEMES } from './types';

// Background-only: the client never imports zod.
// Objects are loose so keys written by a newer build survive a downgrade.
export const configSchema = z.looseObject({
  ui: z.looseObject({
    theme: z.enum(THEMES),
  }),
  language: z.looseObject({
    target: z.enum(LANGUAGE_CODES),
  }),
});

export type ConfigSchema = typeof configSchema;
