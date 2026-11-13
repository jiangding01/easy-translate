import { z } from 'zod';
import { isPlainObject } from './merge';
import { configSchema } from './schema';
import type { ConfigPath } from './types';

/**
 * Walks object shapes and stops at anything else (leaf, array, record), so
 * the whitelist is derived from the schema instead of maintained by hand.
 */
export function derivePaths(schema: z.ZodType, prefix = ''): string[] {
  if (!(schema instanceof z.ZodObject)) return prefix ? [prefix] : [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).flatMap(([key, child]) =>
    derivePaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

export const CONFIG_PATHS: readonly string[] = derivePaths(configSchema);

export function isConfigPath(path: unknown): path is ConfigPath {
  return typeof path === 'string' && CONFIG_PATHS.includes(path);
}

export function getPath(target: unknown, path: string): unknown {
  let current = target;
  for (const key of path.split('.')) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Returns a copy of `target` with `value` at `path`. Intermediate objects are
 * cloned (or created when missing); the value itself replaces whatever was
 * there, so arrays and records are swapped as a whole.
 */
export function setPath<T>(target: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return target;
  const source: Record<string, unknown> = isPlainObject(target) ? target : {};
  const next = rest.length === 0 ? value : setPath(source[head], rest.join('.'), value);
  return { ...source, [head]: next } as T;
}
