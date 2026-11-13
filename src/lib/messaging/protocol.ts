import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ConfigChange, ConfigPath, ConfigSnapshot } from '@/lib/config/types';
import type { Result } from '@/lib/errors';

/**
 * One-shot messages between contexts. Every reply is a `Result`: handlers are
 * wrapped with `handle()` and senders go through `call()`, so nothing throws
 * across a context boundary. Payloads are not validated: every sender is this
 * extension's own code (config writes are validated by the repository).
 */
export interface ProtocolMap {
  'config.patch'(changes: ConfigChange[]): Result<ConfigSnapshot>;
  'config.reset'(paths?: ConfigPath[]): Result<ConfigSnapshot>;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
