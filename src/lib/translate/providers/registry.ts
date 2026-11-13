import type { ConfigV1, Engine } from '@/lib/config/types';
import { normalizeBaseURL } from '../base-url';
import type { ProviderAdapter, ProviderSettings } from '../types';
import { createGeminiAdapter } from './gemini';
import { createGoogleAdapter } from './google';
import { createOpenAICompatAdapter } from './openai-compat';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const google = createGoogleAdapter();
const openaiCompat = createOpenAICompatAdapter();
const gemini = createGeminiAdapter();

export function getAdapter(engine: Engine): ProviderAdapter {
  if (engine === 'google') return google;
  if (engine === 'gemini') return gemini;
  return openaiCompat;
}

/** Resolves the effective baseURL (normalized) and model for an engine. Google needs neither. */
export function resolveProviderSettings(
  engine: Engine,
  providers: ConfigV1['providers'],
): ProviderSettings {
  switch (engine) {
    case 'google':
      return { baseURL: '', model: '' };
    case 'openai':
      return { baseURL: normalizeBaseURL(providers.openai.baseURL), model: providers.openai.model };
    case 'deepseek':
      return { baseURL: DEEPSEEK_BASE_URL, model: providers.deepseek.model };
    case 'gemini':
      return { baseURL: GEMINI_BASE_URL, model: providers.gemini.model };
    case 'custom':
      return { baseURL: normalizeBaseURL(providers.custom.baseURL), model: providers.custom.model };
  }
}
