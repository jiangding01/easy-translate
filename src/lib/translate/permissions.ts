import { browser } from 'wxt/browser';
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

/**
 * Checks the optional host permission of a custom endpoint before any request is
 * made. Built-in providers are covered by `host_permissions` and need no check.
 */
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
