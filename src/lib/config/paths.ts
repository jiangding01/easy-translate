import { z } from 'zod';
import { isPlainObject } from './merge';
import { configSchema } from './schema';
import type { ConfigPath } from './types';

/** Strips optional/default/nullable wrappers so wrapped objects still expand. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}

/**
 * Walks object shapes and stops at anything else (leaf, array, record), so
 * the whitelist is derived from the schema instead of maintained by hand.
 */
export function derivePaths(schema: z.ZodType, prefix = ''): string[] {
  const inner = unwrap(schema);
  if (!(inner instanceof z.ZodObject)) return prefix ? [prefix] : [];
  return Object.entries(inner.shape as Record<string, z.ZodType>).flatMap(([key, child]) =>
    derivePaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

export const CONFIG_PATHS: readonly string[] = derivePaths(configSchema);

export function isConfigPath(path: unknown): path is ConfigPath {
  return typeof path === 'string' && CONFIG_PATHS.includes(path);
}

/** Reads by path segments; keys may contain dots (record keys are arbitrary). */
export function getIn(target: unknown, segments: readonly string[]): unknown {
  let current = target;
  for (const key of segments) {
    // Own keys only: a record key like "constructor" must not reach Object.prototype.
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Returns a copy of `target` with `value` at `segments`. Intermediate objects
 * are cloned (or created when missing); the value itself replaces whatever was
 * there, so arrays and records are swapped as a whole.
 */
export function setIn<T>(target: T, segments: readonly string[], value: unknown): T {
  const [head, ...rest] = segments;
  if (head === undefined) return target;
  const source: Record<string, unknown> = isPlainObject(target) ? target : {};
  const next = rest.length === 0 ? value : setIn(source[head], rest, value);
  return { ...source, [head]: next } as T;
}

/** Copy of `target` without the node at `segments` (unchanged when the parent is missing). */
export function deleteIn(target: unknown, segments: readonly string[]): unknown {
  const parentSegments = segments.slice(0, -1);
  const last = segments.at(-1);
  const parent = parentSegments.length ? getIn(target, parentSegments) : target;
  if (last === undefined || !isPlainObject(parent)) return target;
  const { [last]: _removed, ...rest } = parent;
  return parentSegments.length ? setIn(target, parentSegments, rest) : rest;
}

/** Dot-path forms for schema-derived config paths (whose keys never contain dots). */
export function getPath(target: unknown, path: string): unknown {
  return getIn(target, path.split('.'));
}

export function setPath<T>(target: T, path: string, value: unknown): T {
  return setIn(target, path.split('.'), value);
}
