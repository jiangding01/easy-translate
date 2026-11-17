import { describe, expect, it } from 'vitest';
import { BUILTIN_ENGINES } from '@/lib/config/types';
import { PROVIDER_ICONS, providerIconFor } from './provider-icons';

const CUSTOM = 'custom-aaaaaaaa';

describe('providerIconFor', () => {
  it('gives every built-in engine its own icon, whatever the address', () => {
    for (const engine of BUILTIN_ENGINES) {
      expect(providerIconFor(engine)).toBe(PROVIDER_ICONS[engine]);
    }
    expect(providerIconFor('openai', 'https://openrouter.ai/api/v1')).toBe(PROVIDER_ICONS.openai);
  });

  it('recognizes the custom-service presets by host and local port', () => {
    expect(providerIconFor(CUSTOM, 'http://localhost:11434/v1')).toBe(PROVIDER_ICONS.ollama);
    expect(providerIconFor(CUSTOM, 'http://127.0.0.1:11434/v1')).toBe(PROVIDER_ICONS.ollama);
    expect(providerIconFor(CUSTOM, 'http://localhost:1234/v1')).toBe(PROVIDER_ICONS.lmstudio);
    expect(providerIconFor(CUSTOM, ' http://127.0.0.1:1234 ')).toBe(PROVIDER_ICONS.lmstudio);
    expect(providerIconFor(CUSTOM, 'https://openrouter.ai/api/v1')).toBe(PROVIDER_ICONS.openrouter);
    expect(providerIconFor(CUSTOM, 'https://api.siliconflow.cn/v1')).toBe(
      PROVIDER_ICONS.siliconflow,
    );
    expect(providerIconFor(CUSTOM, 'https://API.SiliconFlow.com/v1')).toBe(
      PROVIDER_ICONS.siliconflow,
    );
  });

  it('knows nothing of other ports, hosts or addresses that do not parse', () => {
    for (const baseURL of [
      'http://localhost:8080/v1',
      'http://localhost/v1',
      'http://192.168.1.2:11434/v1',
      'https://example.com/v1',
      'https://openrouter.ai.example.com/v1',
      'https://example.com/openrouter.ai/v1',
      'https://siliconflow.cn/v1',
      '',
      '   ',
      'not a url',
      'localhost:11434',
    ]) {
      expect(providerIconFor(CUSTOM, baseURL), baseURL).toBeUndefined();
    }
    expect(providerIconFor(CUSTOM)).toBeUndefined();
  });
});

describe('PROVIDER_ICONS', () => {
  it('has at least one path per icon; monochrome icons leave the fill to the text color', () => {
    for (const [id, icon] of Object.entries(PROVIDER_ICONS)) {
      expect(icon.viewBox, id).toBe('0 0 24 24');
      expect(icon.paths.length, id).toBeGreaterThan(0);
      for (const path of icon.paths) expect(path.d, id).toMatch(/^M/);
    }
    for (const id of ['openai', 'ollama', 'lmstudio', 'openrouter'] as const) {
      for (const path of PROVIDER_ICONS[id].paths) expect(path, id).not.toHaveProperty('fill');
    }
    expect(PROVIDER_ICONS.gemini.paths).toEqual([expect.objectContaining({ fill: '#3186FF' })]);
  });
});
