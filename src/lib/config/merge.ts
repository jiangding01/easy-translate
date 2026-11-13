// Plain-object helpers shared by the background parser and the zod-free client.

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Fills keys missing from `value` with `defaults`, recursing into plain objects.
 * Existing values (even of the wrong type) and unknown keys are kept as-is;
 * validation decides what to do with them.
 */
export function mergeDefaults(defaults: unknown, value: unknown): unknown {
  if (value === undefined) return structuredClone(defaults);
  if (!isPlainObject(defaults) || !isPlainObject(value)) return value;
  const merged: Record<string, unknown> = { ...value };
  for (const [key, fallback] of Object.entries(defaults)) {
    merged[key] = mergeDefaults(fallback, value[key]);
  }
  return merged;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}
