export type ErrorKind =
  | 'config'
  | 'network'
  | 'rate-limit'
  | 'provider'
  | 'validation'
  | 'internal';

const ERROR_KINDS: readonly ErrorKind[] = [
  'config',
  'network',
  'rate-limit',
  'provider',
  'validation',
  'internal',
];

export type ErrorCode<K extends ErrorKind = ErrorKind> = `${K}/${string}`;

/**
 * Serializable error shared by every context. `code` is the stable key for
 * user-facing copy; `message` is for developers and must never contain
 * secrets or source text.
 */
export interface AppError {
  kind: ErrorKind;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export function appError<K extends ErrorKind>(
  kind: K,
  code: ErrorCode<K>,
  message: string,
  options: { retryable?: boolean; retryAfterMs?: number } = {},
): AppError {
  const error: AppError = { kind, code, message, retryable: options.retryable ?? false };
  if (options.retryAfterMs !== undefined) error.retryAfterMs = options.retryAfterMs;
  return error;
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, code, message, retryable } = value as Record<string, unknown>;
  return (
    typeof kind === 'string' &&
    (ERROR_KINDS as readonly string[]).includes(kind) &&
    typeof code === 'string' &&
    code.startsWith(`${kind}/`) &&
    typeof message === 'string' &&
    typeof retryable === 'boolean'
  );
}

/** Normalizes anything thrown into an AppError; unknown failures become `internal`. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  if (value instanceof Error) return appError('internal', 'internal/unexpected', value.message);
  if (typeof value === 'string') return appError('internal', 'internal/unexpected', value);
  return appError('internal', 'internal/unknown', 'Unknown error');
}

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(error: AppError): { ok: false; error: AppError } {
  return { ok: false, error };
}
