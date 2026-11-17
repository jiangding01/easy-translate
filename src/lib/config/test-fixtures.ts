// Test-only: defaults for the fields appended after M0, so older fixtures stay short.
export const EXTRA_DEFAULTS = {
  translation: { engine: 'google' },
  page: { style: 'faded', mode: 'bilingual', isleDock: 'right' },
  selection: { showDot: true },
  providers: {
    openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
    deepseek: { model: 'deepseek-chat' },
    gemini: { model: '' },
  },
  customProviders: {},
} as const;
