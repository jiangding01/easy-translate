// Text filters and digests for translation units. Pure.

const LETTER = /\p{L}/gu;
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

/** Worth sending: at least two letters, not an identifier-like token, not oversized. */
export function isTranslatableText(text: string): boolean {
  const trimmed = collapseWhitespace(text).trim();
  if (trimmed.length === 0 || trimmed.length > MAX_UNIT_CHARS) return false;
  const letters = trimmed.match(LETTER);
  if (!letters || letters.length < 2) return false;
  return !NOT_PROSE.some((pattern) => pattern.test(trimmed));
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
