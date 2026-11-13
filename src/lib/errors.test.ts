import { describe, expect, it } from 'vitest';
import { appError, isAppError, toAppError } from './errors';

describe('toAppError', () => {
  it('maps an Error to internal/unexpected', () => {
    expect(toAppError(new Error('boom'))).toEqual({
      kind: 'internal',
      code: 'internal/unexpected',
      message: 'boom',
      retryable: false,
    });
  });

  it('maps a string to internal/unexpected', () => {
    expect(toAppError('boom')).toMatchObject({ kind: 'internal', message: 'boom' });
  });

  it('passes an AppError-shaped object through unchanged', () => {
    const error = { kind: 'network', code: 'network/offline', message: 'x', retryable: true };
    expect(toAppError(error)).toBe(error);
  });

  it('rejects objects whose code does not match their kind', () => {
    expect(isAppError({ kind: 'network', code: 'config/x', message: '', retryable: true })).toBe(
      false,
    );
  });

  it('maps null to internal/unknown', () => {
    expect(toAppError(null)).toMatchObject({ kind: 'internal', code: 'internal/unknown' });
  });

  it('keeps retryAfterMs only when provided', () => {
    expect(appError('rate-limit', 'rate-limit/429', 'slow down', { retryAfterMs: 1000 })).toEqual({
      kind: 'rate-limit',
      code: 'rate-limit/429',
      message: 'slow down',
      retryable: false,
      retryAfterMs: 1000,
    });
    expect(appError('internal', 'internal/x', 'x')).not.toHaveProperty('retryAfterMs');
  });
});
