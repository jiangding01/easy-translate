import { engineFields, hasEditableBaseURL } from '@/lib/config/engine-fields';
import type { BuiltinEngine, ConfigV1 } from '@/lib/config/types';
import {
  BUILTIN_NAMES,
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

// What the page isle may know about engines: a read-only whitelist computed in the
// background (a content script can neither query host permissions nor read key status).

/** Shown for a custom provider without a name; never falls back to its host. */
export const UNNAMED_CUSTOM_NAME = '自定义服务';
const UNNAMED_CUSTOM_SHORT = '自';

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

/** First two characters of a name, by grapheme, so an emoji or accent is never cut in half. */
function shortOf(name: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...segmenter.segment(name)]
    .slice(0, 2)
    .map((part) => part.segment)
    .join('');
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
      const short = custom
        ? customName
          ? shortOf(customName)
          : UNNAMED_CUSTOM_SHORT
        : BUILTIN_SHORT[entry.id as BuiltinEngine];
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
      };
    }),
  );
  return { configured: config.translation.engine, options };
}
