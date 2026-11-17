// The single-word rule shared by the selection card (whether to ask for a phonetic) and the
// background lookup (which never trusts the card). No imports: the card bundles it.

/** Longer words are never looked up. */
export const MAX_WORD_LENGTH = 40;

/** Punctuation and spaces around the word; digits stay, so `mp3` or `x2` is not a word. */
const EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
/** Letters a–z, with at most one apostrophe inside (o'clock). */
const WORD = /^[a-z]+(?:'[a-z]+)?$/;

/**
 * The lookup key for a single English word: curly apostrophes made straight, lowercase,
 * leading and trailing punctuation dropped, then a final `'s`. Undefined for anything that
 * is not a word of a–z letters (at most one inner apostrophe, at most 40 letters).
 */
export function phoneticKey(text: string): string | undefined {
  // Not worth normalizing: no single word is this long.
  if (text.length > MAX_WORD_LENGTH * 2) return undefined;
  const word = text.replace(/’/g, "'").toLowerCase().replace(EDGES, '').replace(/'s$/, '');
  return word.length <= MAX_WORD_LENGTH && WORD.test(word) ? word : undefined;
}
