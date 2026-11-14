import type { z } from 'zod';
import { createDefaultConfig } from './defaults';
import { deepEqual, isPlainObject, mergeDefaults } from './merge';
import { deleteIn, getIn, setIn } from './paths';
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
  // Keyed by JSON of the array's segments; segments are kept as arrays throughout
  // because record keys may contain dots.
  const removals = new Map<string, { segments: string[]; indices: Set<number> }>();

  for (const issue of issues) {
    const path = issue.path;
    if (path.length === 0) {
      resetPaths.push(ROOT);
      return structuredClone(defaults);
    }

    // Invalid array element (possibly deep inside it): drop just that element.
    const elementIndex = path.findLastIndex((segment) => typeof segment === 'number');
    if (elementIndex >= 0) {
      const segments = path.slice(0, elementIndex).map(String);
      const id = JSON.stringify(segments);
      const entry = removals.get(id) ?? { segments, indices: new Set<number>() };
      entry.indices.add(path[elementIndex] as number);
      removals.set(id, entry);
      resetPaths.push(path.map(String).join('.'));
      continue;
    }

    // Inside something the defaults do not have (a record entry, an unknown key):
    // remove the outermost such node, e.g. the whole custom provider, never more.
    const segments = path.map(String);
    const missingAt = segments.findIndex(
      (_, index) => getIn(defaults, segments.slice(0, index + 1)) === undefined,
    );
    if (missingAt >= 0) {
      const node = segments.slice(0, missingAt + 1);
      next = deleteIn(next, node);
      resetPaths.push(node.join('.'));
      continue;
    }

    // Invalid leaf, or a parent of the wrong type: reset that node to its default.
    next = setIn(next, segments, structuredClone(getIn(defaults, segments)));
    resetPaths.push(segments.join('.'));
  }

  for (const { segments, indices } of removals.values()) {
    const list = segments.length ? getIn(next, segments) : next;
    if (!Array.isArray(list)) continue;
    const kept = list.filter((_, index) => !indices.has(index));
    next = segments.length ? setIn(next, segments, kept) : kept;
  }
  return next;
}
