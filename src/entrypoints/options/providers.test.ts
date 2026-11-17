import { describe, expect, it } from 'vitest';
import { defaultProviderName, newCustomId, PRESETS } from './providers';

describe('newCustomId', () => {
  it('makes a valid id and skips taken ones', () => {
    const fixed = (value: number) => (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(value);
    expect(newCustomId([], fixed(0))).toBe('custom-aaaaaaaa');
    let calls = 0;
    const random = (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(calls++ === 0 ? 0 : 1);
    expect(newCustomId(['custom-aaaaaaaa'], random)).toBe('custom-bbbbbbbb');
    expect(newCustomId([])).toMatch(/^custom-[a-z0-9]{8}$/);
  });

  it('draws every character uniformly: bytes past the last whole round of 36 are skipped', () => {
    // 252 = 7 × 36. Mapping 252–255 with `% 36` would favor a–d.
    const bytes = [255, 252, 0, 253, 35, 1, 254, 2, 3, 4, 5, 6];
    let next = 0;
    const random = (buffer: Uint8Array<ArrayBuffer>) => {
      for (let i = 0; i < buffer.length; i += 1) buffer[i] = bytes[next++ % bytes.length] ?? 0;
      return buffer;
    };
    expect(newCustomId([], random)).toBe('custom-a9bcdefg');
  });
});

describe('names and hosts', () => {
  it('keeps the preset label only while its address is untouched', () => {
    const ollama = PRESETS.find((preset) => preset.id === 'ollama');
    expect(defaultProviderName(ollama, 'http://localhost:11434/v1/')).toBe('Ollama（本地）');
    expect(defaultProviderName(ollama, 'http://localhost:9999/v1')).toBe('localhost:9999');
  });
});
