import { browser } from 'wxt/browser';
import type { Engine } from '@/lib/config/types';
import {
  BUILTIN_ORIGINS,
  type EndpointOrigin,
  parseEndpointOrigin,
  requiredHostPermission,
} from '@/lib/endpoint';
import { appError, fail, type Result } from '@/lib/errors';

export { BUILTIN_ORIGINS, type EndpointOrigin, parseEndpointOrigin };

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

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com';

/**
 * The single endpoint gate for every engine, run before any request. It makes
 * the same decision as the pages' `requiredHostPermission`: a built-in origin
 * passes as is; anything else must be https (or http on localhost) and hold the
 * optional host permission. Google ignores `baseURL`: its endpoint is fixed.
 */
export async function checkEngineEndpoint(
  engine: Engine,
  baseURL: string,
  deps: PermissionDeps = defaultDeps,
): Promise<Result<EndpointOrigin>> {
  const url = engine === 'google' ? GOOGLE_ENDPOINT : baseURL;
  const required = requiredHostPermission(url);
  if (!required.ok) return required;
  if (required.data === null) {
    const parsed = parseEndpointOrigin(url);
    return parsed;
  }
  return checkEndpointPermission(url, deps);
}
