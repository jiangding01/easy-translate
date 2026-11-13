// Mistyped endpoint suffixes users paste from API docs. Longest match first.
const ENDPOINT_SUFFIXES = ['/chat/completions', '/responses', '/completions'];

/** Trims, drops trailing slashes and a mistakenly appended endpoint path. */
export function normalizeBaseURL(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  const lower = url.toLowerCase();
  const suffix = ENDPOINT_SUFFIXES.find((candidate) => lower.endsWith(candidate));
  if (suffix) url = url.slice(0, -suffix.length).replace(/\/+$/, '');
  return url;
}
