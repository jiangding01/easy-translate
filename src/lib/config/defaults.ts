import { defaultTargetLanguage } from '@/lib/languages';
import { CONFIG_SCHEMA_VERSION, type ConfigSnapshot, type ConfigV1 } from './types';

export function createDefaultConfig(uiLanguage: string): ConfigV1 {
  return {
    ui: { theme: 'system' },
    language: { target: defaultTargetLanguage(uiLanguage), source: 'auto' },
    translation: { engine: 'google' },
    providers: {
      openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
      deepseek: { model: 'deepseek-chat' },
      gemini: { model: '' },
      custom: { baseURL: '', model: '' },
    },
  };
}

export function createDefaultSnapshot(uiLanguage: string): ConfigSnapshot {
  return { schemaVersion: CONFIG_SCHEMA_VERSION, data: createDefaultConfig(uiLanguage) };
}
