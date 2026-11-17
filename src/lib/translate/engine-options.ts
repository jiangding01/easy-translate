import { engineFields, hasEditableBaseURL } from '@/lib/config/engine-fields';
import type { BuiltinEngine, ConfigV1 } from '@/lib/config/types';
import {
  BUILTIN_NAMES,
  customShort,
  engineEntries,
  engineReadiness,
  NOT_READY_TEXT,
  permissionPattern,
} from '@/lib/engine-view';
import type {
  EngineOption,
  EngineOptions,
  SecretProviderId,
  SecretStatusInfo,
} from '@/lib/messaging/protocol';
import { providerIconFor } from '@/lib/provider-icons';

// What the page isle may know about engines: a read-only whitelist computed in the
// background (a content script can neither query host permissions nor read key status).

/** Shown for a custom provider without a name; never falls back to its host. */
export const UNNAMED_CUSTOM_NAME = '自定义服务';

const BUILTIN_SHORT: Record<BuiltinEngine, string> = {
  google: 'G',
  openai: 'AI',
  deepseek: 'DS',
  gemini: 'Ge',
};

export interface EngineOptionsInput {
  config: ConfigV1;
  secrets: Partial<Record<SecretProviderId, SecretStatusInfo>>;
  /** Whether an optional host permission pattern is granted. */
  hasPermission(pattern: string): Promise<boolean>;
}

export async function buildEngineOptions(input: EngineOptionsInput): Promise<EngineOptions> {
  const { config, secrets, hasPermission } = input;
  const options = await Promise.all(
    engineEntries(config).map(async (entry): Promise<EngineOption> => {
      const fields = engineFields(config, entry.id) ?? { baseURL: '', model: '' };
      const pattern = hasEditableBaseURL(entry.id) ? permissionPattern(fields.baseURL) : undefined;
      const granted = pattern ? await hasPermission(pattern).catch(() => false) : undefined;
      const readiness = engineReadiness({
        engine: entry.id,
        ...fields,
        secret: entry.id === 'google' ? undefined : secrets[entry.id as SecretProviderId],
        granted,
      });
      const custom = entry.custom;
      const customName = custom?.name.trim() ?? '';
      const name = custom
        ? customName || UNNAMED_CUSTOM_NAME
        : BUILTIN_NAMES[entry.id as BuiltinEngine];
      const short = custom ? customShort(custom.name) : BUILTIN_SHORT[entry.id as BuiltinEngine];
      const icon = providerIconFor(entry.id, fields.baseURL);
      // A transient (still unknown) grant never reaches here: the query above is a boolean.
      const note = readiness.reason
        ? NOT_READY_TEXT[readiness.reason as keyof typeof NOT_READY_TEXT]
        : undefined;
      return {
        id: entry.id,
        name,
        short,
        ready: readiness.reason === undefined,
        ...(note ? { note } : {}),
        ...(icon ? { icon } : {}),
      };
    }),
  );
  return { configured: config.translation.engine, options };
}
