import { browser } from 'wxt/browser';

export const targetLanguages = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
} as const;

export interface Settings {
  targetLanguage: keyof typeof targetLanguages;
  displayMode: 'bilingual' | 'replace';
}

export const defaultSettings: Settings = {
  targetLanguage: 'zh-CN',
  displayMode: 'bilingual',
};

// Storage can contain data from older versions or manual edits.
export function parseSettings(value: unknown): Settings {
  const input = value && typeof value === 'object' ? value : {};
  const language = 'targetLanguage' in input ? input.targetLanguage : undefined;
  return {
    targetLanguage:
      typeof language === 'string' && Object.hasOwn(targetLanguages, language)
        ? (language as Settings['targetLanguage'])
        : defaultSettings.targetLanguage,
    displayMode:
      'displayMode' in input && input.displayMode === 'replace'
        ? 'replace'
        : defaultSettings.displayMode,
  };
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await browser.storage.local.get('settings');
  return parseSettings(settings);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings: parseSettings(settings) });
}
