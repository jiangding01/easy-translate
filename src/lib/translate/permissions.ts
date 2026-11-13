import { browser } from 'wxt/browser';
import type { Engine } from '@/lib/config/types';
import { type AppError, appError, fail, ok, type Result } from '@/lib/errors';
import { normalizeBaseURL } from './base-url';

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

export interface PermissionDeps {
  contains: (origins: string[]) => Promise<boolean>;
}

const defaultDeps: PermissionDeps = {
  contains: (origins) => browser.permissions.contains({ origins }),
};

/** Checks the optional host permission of an endpoint before any request is made. */
export async function checkEndpointPermission(
  baseURL: string,
  deps: PermissionDeps = defaultDeps,
): Promise<Result<EndpointOrigin>> {
  const parsed = parseEndpointOrigin(baseURL);
  if (!parsed.ok) return parsed;
  let granted = false;
  try {
    granted = await deps.contains([parsed.data.pattern]);
  } catch {
    granted = false;
  }
  if (!granted) {
    return fail(
      appError('config', 'config/permission-missing', 'Host permission has not been granted'),
    );
  }
  return parsed;
}

/** Origins covered by the manifest's `host_permissions`. */
export const BUILTIN_ORIGINS: ReadonlySet<string> = new Set([
  'https://translate.googleapis.com',
  'https://api.openai.com',
  'https://api.deepseek.com',
  'https://generativelanguage.googleapis.com',
]);

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com';

function originOf(baseURL: string): string | undefined {
  try {
    return new URL(normalizeBaseURL(baseURL)).origin;
  } catch {
    return undefined;
  }
}

/**
 * The single endpoint gate for every engine, run before any request. A built-in
 * origin passes as is; anything else must be https (or http on localhost) and
 * hold the optional host permission. Google ignores `baseURL`: its endpoint is fixed.
 */
export async function checkEngineEndpoint(
  engine: Engine,
  baseURL: string,
  deps: PermissionDeps = defaultDeps,
): Promise<Result<EndpointOrigin>> {
  const url = engine === 'google' ? GOOGLE_ENDPOINT : baseURL;
  const origin = originOf(url);
  if (origin !== undefined && BUILTIN_ORIGINS.has(origin)) {
    const { hostname } = new URL(origin);
    return ok({ pattern: `https://${hostname}/*`, origin });
  }
  return checkEndpointPermission(url, deps);
}
