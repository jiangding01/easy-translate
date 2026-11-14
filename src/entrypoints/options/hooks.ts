import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from '@/lib/errors';
import { call } from '@/lib/messaging/handle';
import {
  type CacheStatsInfo,
  type ProviderTestDraft,
  type ProviderTestResult,
  type SecretProviderId,
  type SecretStatusInfo,
  sendMessage,
} from '@/lib/messaging/protocol';

// Background calls of the settings page. Every reply is a Result; nothing throws.

export const admin = {
  setSecret: (provider: SecretProviderId, key: string | null) =>
    call(() => sendMessage('secrets.set', { provider, key })),
  secretStatus: () => call(() => sendMessage('secrets.status', undefined)),
  test: (draft: ProviderTestDraft): Promise<Result<ProviderTestResult>> =>
    call(() => sendMessage('provider.test', draft)),
  cacheStats: (): Promise<Result<CacheStatsInfo>> =>
    call(() => sendMessage('cache.stats', undefined)),
  clearCache: () => call(() => sendMessage('cache.clear', undefined)),
};

export type SecretStatuses = Partial<Record<SecretProviderId, SecretStatusInfo>>;

/** Key status of every provider; `refresh` after any secrets.set. */
export function useSecretStatuses(): { statuses: SecretStatuses | undefined; refresh: () => void } {
  const [statuses, setStatuses] = useState<SecretStatuses>();
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const sequence = ++latest.current;
    void admin.secretStatus().then((result) => {
      if (sequence === latest.current && result.ok) setStatuses(result.data);
    });
  }, []);
  useEffect(() => refresh(), [refresh]);
  return { statuses, refresh };
}
