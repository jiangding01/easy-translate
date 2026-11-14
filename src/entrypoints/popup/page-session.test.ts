import { describe, expect, it } from 'vitest';
import { appError } from '@/lib/errors';
import { pausedReason } from './page-session';

describe('pausedReason', () => {
  it('gives a short reason per engine-level error', () => {
    expect(pausedReason(appError('provider', 'provider/unauthorized', 'x'))).toBe('密钥无效');
    expect(pausedReason(appError('provider', 'provider/quota-exceeded', 'x'))).toBe('额度已用完');
    expect(pausedReason(appError('provider', 'provider/local-origin-rejected', 'x'))).toBe(
      '本地服务拒绝了请求',
    );
    expect(pausedReason(appError('config', 'config/permission-missing', 'x'))).toBe(
      '还没有授权访问接口',
    );
    expect(pausedReason(appError('config', 'config/model-required', 'x'))).toBe('设置不完整');
  });
});
