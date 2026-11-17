import { describe, expect, it } from 'vitest';
import { describeError, withUserMessage } from './error-messages';
import { appError } from './errors';

describe('withUserMessage', () => {
  it('fills userMessage for a code in the table', () => {
    const error = appError('provider', 'provider/unauthorized', 'HTTP 401');
    expect(withUserMessage(error)).toEqual({
      ...error,
      userMessage: describeError(error),
    });
    expect(withUserMessage(error).userMessage).toContain('密钥无效');
  });

  it('leaves an unknown code without userMessage (no generic fallback)', () => {
    const error = appError('internal', 'internal/whatever', 'x');
    const decorated = withUserMessage(error);
    expect(decorated).toEqual(error);
    expect(decorated).not.toHaveProperty('userMessage');
  });

  it('does not mutate the original error', () => {
    const error = appError('network', 'network/timeout', 'slow');
    withUserMessage(error);
    expect(error).not.toHaveProperty('userMessage');
  });
});
