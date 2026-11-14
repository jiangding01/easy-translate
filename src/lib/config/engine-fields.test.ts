import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './defaults';
import { engineFields, fieldChange, hasEditableBaseURL, takesApiKey } from './engine-fields';
import { BUILTIN_ENGINES } from './types';

describe('engine fields', () => {
  const config = createDefaultConfig('en');
  config.customProviders['custom-aaaaaaaa'] = {
    name: 'A',
    baseURL: 'http://localhost:11434/v1',
    model: 'q',
  };

  it('reads every engine from one place', () => {
    expect(engineFields(config, 'google')).toEqual({ baseURL: '', model: '' });
    expect(engineFields(config, 'openai')).toEqual({
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
    });
    expect(engineFields(config, 'deepseek')).toEqual({ baseURL: '', model: 'deepseek-chat' });
    expect(engineFields(config, 'custom-aaaaaaaa')).toEqual({
      baseURL: 'http://localhost:11434/v1',
      model: 'q',
    });
    expect(engineFields(config, 'custom-zzzzzzzz')).toBeUndefined();
  });

  it('writes each field to its own path, and updates custom providers field by field', () => {
    expect(fieldChange('openai', 'baseURL', 'u')).toEqual({
      path: 'providers.openai.baseURL',
      value: 'u',
    });
    expect(fieldChange('gemini', 'model', 'g')).toEqual({
      path: 'providers.gemini.model',
      value: 'g',
    });
    expect(fieldChange('deepseek', 'baseURL', 'u')).toBeUndefined();
    expect(fieldChange('google', 'model', 'x')).toBeUndefined();
    expect(fieldChange('custom-aaaaaaaa', 'model', 'm')).toEqual({
      path: 'customProviders',
      key: 'custom-aaaaaaaa',
      update: { model: 'm' },
    });
  });

  it('knows which engines take a base URL and a key', () => {
    expect(BUILTIN_ENGINES.filter(hasEditableBaseURL)).toEqual(['openai']);
    expect(hasEditableBaseURL('custom-aaaaaaaa')).toBe(true);
    expect(BUILTIN_ENGINES.filter(takesApiKey)).toEqual(['openai', 'deepseek', 'gemini']);
  });
});
