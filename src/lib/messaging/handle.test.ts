import { describe, expect, it } from 'vitest';
import { appError, ok, type Result } from '@/lib/errors';
import { call, handle } from './handle';

describe('handle', () => {
  it('wraps a returned value in ok', async () => {
    expect(await handle((n: number) => n * 2)(21)).toEqual({ ok: true, data: 42 });
  });

  it('passes a thrown AppError through unchanged', async () => {
    const error = appError('config', 'config/invalid-value', 'bad');
    const result = await handle(async () => {
      throw error;
    })();
    expect(result).toEqual({ ok: false, error });
  });

  it('maps an unknown exception to internal', async () => {
    const result = await handle(() => {
      throw new TypeError('oops');
    })();
    expect(result).toEqual({
      ok: false,
      error: { kind: 'internal', code: 'internal/unexpected', message: 'oops', retryable: false },
    });
  });
});

describe('call', () => {
  it('returns the receiver result as-is', async () => {
    expect(await call(async () => ok('hi'))).toEqual({ ok: true, data: 'hi' });
  });

  it('normalizes an unreachable receiver into a Result instead of throwing', async () => {
    const result = await call(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'network/extension-unreachable', retryable: true },
    });
  });

  it('uses the caller-provided error for an unreachable receiver', async () => {
    const unreachable = appError('network', 'network/page-unreachable', 'no page');
    const result = await call(() => Promise.reject(new Error('x')), unreachable);
    expect(result).toMatchObject({ ok: false, error: { code: 'network/page-unreachable' } });
  });

  it('rejects a malformed reply', async () => {
    const result = await call(async () => undefined as never);
    expect(result).toMatchObject({ ok: false, error: { code: 'internal/invalid-response' } });
  });

  it('accepts an ok result whose data key was dropped by serialization', async () => {
    expect(await call(() => Promise.resolve({ ok: true } as unknown as Result<void>))).toEqual({
      ok: true,
    });
  });
});
