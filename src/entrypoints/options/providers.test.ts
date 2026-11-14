import { describe, expect, it } from 'vitest';
import { defaultProviderName, newCustomId, PRESETS } from './providers';

describe('newCustomId', () => {
  it('makes a valid id and skips taken ones', () => {
    const fixed = (value: number) => (bytes: Uint8Array) => bytes.fill(value);
    expect(newCustomId([], fixed(0))).toBe('custom-aaaaaaaa');
    let calls = 0;
    const random = (bytes: Uint8Array) => bytes.fill(calls++ === 0 ? 0 : 1);
    expect(newCustomId(['custom-aaaaaaaa'], random)).toBe('custom-bbbbbbbb');
    expect(newCustomId([])).toMatch(/^custom-[a-z0-9]{8}$/);
  });
});

describe('names and hosts', () => {
  it('keeps the preset label only while its address is untouched', () => {
    const ollama = PRESETS.find((preset) => preset.id === 'ollama');
    expect(defaultProviderName(ollama, 'http://localhost:11434/v1/')).toBe('Ollama（本地）');
    expect(defaultProviderName(ollama, 'http://localhost:9999/v1')).toBe('localhost:9999');
  });
});
