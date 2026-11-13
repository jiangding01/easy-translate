import type { z } from 'zod';
import { createDefaultConfig } from './defaults';
import { deepEqual, isPlainObject, mergeDefaults } from './merge';
import { getPath, setPath } from './paths';
import { configSchema } from './schema';
import { CONFIG_SCHEMA_VERSION, type ConfigSnapshot, type ConfigV1 } from './types';

export const MAX_REPAIR_ROUNDS = 5;
const ROOT = '';

export interface ParsedConfig {
  snapshot: ConfigSnapshot;
  /** The stored value differs from `snapshot` and should be written back. */
  repaired: boolean;
  /** Stored by a newer build: use defaults in memory, never write. */
  readOnly: boolean;
  /** Repairs did not converge; everything was reset to defaults. */
  fallback: boolean;
  /** Dot paths that were reset or removed ('' means the root). */
  resetPaths: string[];
}

interface ParseOptions {
  uiLanguage: string;
  /** Injectable for tests; defaults to the real config schema. */
  schema?: z.ZodType;
}

/**
 * Lenient read of `storage.local["config"]`. Runs on every read (no caching):
 * invalid parts are repaired as locally as possible so one bad field never
 * costs the user the rest of their settings.
 */
export function parseStoredConfig(raw: unknown, options: ParseOptions): ParsedConfig {
  const schema = options.schema ?? configSchema;
  const defaults = createDefaultConfig(options.uiLanguage);
  const build = (data: ConfigV1, extra: Partial<Omit<ParsedConfig, 'snapshot'>>): ParsedConfig => ({
    snapshot: { schemaVersion: CONFIG_SCHEMA_VERSION, data },
    repaired: false,
    readOnly: false,
    fallback: false,
    resetPaths: [],
    ...extra,
  });

  if (!isPlainObject(raw)) return build(defaults, { repaired: true, resetPaths: [ROOT] });

  const version = raw.schemaVersion;
  if (typeof version === 'number' && version > CONFIG_SCHEMA_VERSION) {
    return build(defaults, { readOnly: true });
  }

  let current = mergeDefaults(defaults, raw.data);
  const filled = version !== CONFIG_SCHEMA_VERSION || !deepEqual(current, raw.data);
  const resetPaths: string[] = [];

  for (let round = 0; ; round += 1) {
    const parsed = schema.safeParse(current);
    if (parsed.success) {
      return build(parsed.data as ConfigV1, {
        repaired: filled || resetPaths.length > 0,
        resetPaths,
      });
    }
    if (round === MAX_REPAIR_ROUNDS) break;
    current = repairIssues(current, parsed.error.issues, defaults, resetPaths);
  }

  // Only paths are logged: values may be user content.
  console.warn(
    `[config] stored config still invalid after ${MAX_REPAIR_ROUNDS} repair rounds; using defaults`,
    resetPaths,
  );
  return build(defaults, { repaired: true, fallback: true, resetPaths });
}

function repairIssues(
  value: unknown,
  issues: readonly z.core.$ZodIssue[],
  defaults: ConfigV1,
  resetPaths: string[],
): unknown {
  let next = value;
  const removals = new Map<string, Set<number>>();

  for (const issue of issues) {
    const path = issue.path;
    if (path.length === 0) {
      resetPaths.push(ROOT);
      return structuredClone(defaults);
    }

    // Invalid array element (possibly deep inside it): drop just that element.
    const elementIndex = path.findLastIndex((segment) => typeof segment === 'number');
    if (elementIndex >= 0) {
      const arrayPath = path.slice(0, elementIndex).map(String).join('.');
      const indices = removals.get(arrayPath) ?? new Set<number>();
      indices.add(path[elementIndex] as number);
      removals.set(arrayPath, indices);
      resetPaths.push(path.map(String).join('.'));
      continue;
    }

    // Invalid leaf, or a parent of the wrong type: reset that node to its default.
    const key = path.map(String).join('.');
    const fallback = getPath(defaults, key);
    next =
      fallback === undefined
        ? deletePath(next, key)
        : setPath(next, key, structuredClone(fallback));
    resetPaths.push(key);
  }

  for (const [arrayPath, indices] of removals) {
    const list = arrayPath ? getPath(next, arrayPath) : next;
    if (!Array.isArray(list)) continue;
    const kept = list.filter((_, index) => !indices.has(index));
    next = arrayPath ? setPath(next, arrayPath, kept) : kept;
  }
  return next;
}

function deletePath(target: unknown, path: string): unknown {
  const keys = path.split('.');
  const last = keys.pop();
  const parentPath = keys.join('.');
  const parent = parentPath ? getPath(target, parentPath) : target;
  if (last === undefined || !isPlainObject(parent)) return target;
  const { [last]: _removed, ...rest } = parent;
  return parentPath ? setPath(target, parentPath, rest) : rest;
}
