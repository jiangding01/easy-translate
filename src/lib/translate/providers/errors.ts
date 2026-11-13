import { type AppError, appError, isAppError } from '@/lib/errors';

// Error messages never include request or response bodies: they may carry
// source text or echoed credentials.

export function abortedError(): AppError {
  return appError('network', 'network/aborted', 'Request aborted');
}

export function fetchFailedError(): AppError {
  return appError('network', 'network/fetch-failed', 'Network request failed', {
    retryable: true,
  });
}

export function timeoutError(): AppError {
  return appError('network', 'network/timeout', 'Request timed out', { retryable: true });
}

export function interruptedError(): AppError {
  return appError('network', 'network/stream-interrupted', 'Response stream ended early', {
    retryable: true,
  });
}

export function badResponseError(detail = 'Unexpected response shape'): AppError {
  return appError('validation', 'validation/bad-response', detail);
}

export function modelRequiredError(): AppError {
  return appError('config', 'config/model-required', 'A model must be configured');
}

/** `retry-after` is either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function hasQuotaCode(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    const error = (parsed as { error?: { code?: unknown; type?: unknown } } | null)?.error;
    return error?.code === 'insufficient_quota' || error?.type === 'insufficient_quota';
  } catch {
    return false;
  }
}

/** Maps a non-2xx response to an AppError. Reads the body only to classify it. */
export async function errorFromResponse(response: Response): Promise<AppError> {
  const { status } = response;
  if (status === 401 || status === 403) {
    return appError('provider', 'provider/unauthorized', `HTTP ${status}`);
  }
  if (status === 404) return appError('provider', 'provider/not-found', 'HTTP 404');
  if (status === 429) {
    const body = await readBodyText(response);
    if (hasQuotaCode(body)) {
      return appError('provider', 'provider/quota-exceeded', 'Provider quota exhausted');
    }
    return appError('rate-limit', 'rate-limit/too-many-requests', 'HTTP 429', {
      retryable: true,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }
  if (status >= 500) {
    return appError('provider', 'provider/server-error', `HTTP ${status}`, { retryable: true });
  }
  if (status === 400) {
    // Gemini reports a bad key as 400.
    const body = await readBodyText(response);
    if (body.includes('API_KEY_INVALID')) {
      return appError('provider', 'provider/unauthorized', 'HTTP 400 (invalid API key)');
    }
  }
  return appError('provider', 'provider/bad-request', `HTTP ${status}`);
}

/** fetch that reports failures as AppError (aborted vs. network). */
export async function safeFetch(
  ctx: { signal: AbortSignal; fetch?: typeof fetch },
  url: string,
  init: RequestInit,
): Promise<Response> {
  const doFetch = ctx.fetch ?? globalThis.fetch;
  try {
    return await doFetch(url, { ...init, signal: ctx.signal });
  } catch (error) {
    if (isAppError(error)) throw error;
    throw ctx.signal.aborted ? abortedError() : fetchFailedError();
  }
}
