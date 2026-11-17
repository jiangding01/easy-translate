// Shard names for the phonetic tables, shared by scripts/build-phonetics.mjs and the lookup.
// No imports: the build script runs this file directly under Node.

/**
 * The first `depth` characters of a key, anything but a–z as `_`, padded with `_`
 * (`a` → `a_`, `o'clock` → `o_`, `co` at depth 3 → `co_`).
 */
export function shardKey(word: string, depth: number): string {
  return word
    .slice(0, depth)
    .replace(/[^a-z]/g, '_')
    .padEnd(depth, '_');
}

/**
 * The shard holding `word` among those listed (space-separated), two letters first, then
 * three; undefined when neither exists, so the word is in no table.
 */
export function shardFor(word: string, listed: ReadonlySet<string>): string | undefined {
  for (const depth of [2, 3]) {
    const key = shardKey(word, depth);
    if (listed.has(key)) return key;
  }
  return undefined;
}
