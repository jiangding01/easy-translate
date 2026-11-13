import {
  type AppError,
  appError,
  fail,
  isAppError,
  ok,
  type Result,
  toAppError,
} from '@/lib/errors';

/**
 * Wraps a message handler so it never throws across contexts: the value
 * becomes `ok(data)` and anything thrown becomes `fail(AppError)`.
 */
export function handle<A extends unknown[], T>(
  fn: (...args: A) => T | Promise<T>,
): (...args: A) => Promise<Result<T>> {
  return async (...args) => {
    try {
      return ok(await fn(...args));
    } catch (error) {
      return fail(toAppError(error));
    }
  };
}

function isResult(value: unknown): value is Result<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  // A handler returning undefined loses its `data` key in JSON serialization.
  return result.ok === true || (result.ok === false && isAppError(result.error));
}

/**
 * Sends a message and normalizes messaging-layer failures (receiver missing,
 * SW unreachable, malformed reply) into a `Result` instead of throwing.
 */
export async function call<T>(
  send: () => Promise<Result<T>>,
  unreachable: AppError = appError(
    'network',
    'network/extension-unreachable',
    'Message receiver is unreachable',
    { retryable: true },
  ),
): Promise<Result<T>> {
  let response: unknown;
  try {
    response = await send();
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : '';
    return fail({ ...unreachable, message: `${unreachable.message}${detail}` });
  }
  if (!isResult(response)) {
    return fail(appError('internal', 'internal/invalid-response', 'Malformed message response'));
  }
  return response as Result<T>;
}
