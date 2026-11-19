// Text filters and digests for translation units. Pure.

const NOT_PROSE = [
  /^(https?:\/\/|www\.)\S+$/i, // URL
  /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/, // email
  /^[@#][\p{L}\p{N}_.-]+$/u, // @handle, #tag
  /^[\d\s.,:;%+\-–—/×x()]+[\p{L}%°]{0,4}$/u, // numbers, sizes, times, "12 MB"
  /^[\w-]+\.(js|ts|tsx|jsx|json|md|py|rs|go|java|css|html|png|jpe?g|gif|svg|pdf|zip|txt|yml|yaml)$/i, // file names
  /^[a-z_$][\w$]*(\.[\w$]+)+(\(\))?$/i, // dotted identifiers, calls
  // Dates on their own ("Nov 09, 2026", "28 September 2026", "Sept. 3"): noise when translated.
  /^(?=.*\d)(\d{1,2}\s+)?(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?(\s+\d{1,2}(st|nd|rd|th)?)?,?(\s+\d{4})?$/i,
];

export const MAX_UNIT_CHARS = 5000;

/** Collapses whitespace runs the way rendered HTML does. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** At least two letters, with anything between them (no array allocated for huge text). */
const TWO_LETTERS = /\p{L}\P{L}*\p{L}/u;

/**
 * Worth sending? `plain` (the source text) decides noise; `sentLength` (what is actually
 * sent, inline tags included) decides "long". Noise first: a huge URL is not "too long".
 */
export function classifyText(plain: string, sentLength: number): 'ok' | 'noise' | 'long' {
  const trimmed = collapseWhitespace(plain).trim();
  if (trimmed.length === 0 || !TWO_LETTERS.test(trimmed)) return 'noise';
  if (NOT_PROSE.some((pattern) => pattern.test(trimmed))) return 'noise';
  return sentLength > MAX_UNIT_CHARS ? 'long' : 'ok';
}

/** FNV-1a 32-bit, hex. For change detection and loop guards, never for cache keys. */
export function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
