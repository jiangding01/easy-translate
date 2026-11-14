import { type AppError, appError, fail, ok, type Result } from '@/lib/errors';

// Endpoint helpers shared by the background and extension pages: pure, no browser APIs.

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

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export interface EndpointOrigin {
  /** Match pattern for permissions.request / contains (ports are not part of a pattern). */
  pattern: string;
  origin: string;
}

export function invalidBaseUrlError(): AppError {
  return appError(
    'config',
    'config/invalid-base-url',
    'Base URL must be https, or http on localhost',
  );
}

/** Extracts the permission origin; only https, or http on localhost / 127.0.0.1, is accepted. */
export function parseEndpointOrigin(baseURL: string): Result<EndpointOrigin> {
  let url: URL;
  try {
    url = new URL(normalizeBaseURL(baseURL));
  } catch {
    return fail(invalidBaseUrlError());
  }
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !local) return fail(invalidBaseUrlError());
  return ok({ pattern: `${url.protocol}//${url.hostname}/*`, origin: url.origin });
}

/** Origins covered by the manifest's `host_permissions`. */
export const BUILTIN_ORIGINS: ReadonlySet<string> = new Set([
  'https://translate.googleapis.com',
  'https://api.openai.com',
  'https://api.deepseek.com',
  'https://generativelanguage.googleapis.com',
]);

/**
 * The optional host permission an endpoint needs: `null` for a built-in origin,
 * an error for a URL that can never be used (not https, nor http on localhost).
 */
export function requiredHostPermission(baseURL: string): Result<EndpointOrigin | null> {
  const parsed = parseEndpointOrigin(baseURL);
  if (!parsed.ok) return parsed;
  return ok(BUILTIN_ORIGINS.has(parsed.data.origin) ? null : parsed.data);
}
