import { describe, expect, it } from 'vitest';
import { USER_INPUT_TOKEN } from './codec';
import { buildPrompt, PROMPT_VERSION, promptDigest } from './prompt';

describe('prompt', () => {
  it('has a stable digest for the same inputs', async () => {
    const a = await promptDigest(buildPrompt({ source: 'auto', target: 'zh-CN' }));
    const b = await promptDigest(buildPrompt({ source: 'auto', target: 'zh-CN' }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the digest when the target or source language changes', async () => {
    const base = await promptDigest(buildPrompt({ source: 'auto', target: 'zh-CN' }));
    expect(await promptDigest(buildPrompt({ source: 'auto', target: 'ja' }))).not.toBe(base);
    expect(await promptDigest(buildPrompt({ source: 'en', target: 'zh-CN' }))).not.toBe(base);
  });

  it('declares the version, the input slot and the injection guard', () => {
    const prompt = buildPrompt({ source: 'auto', target: 'en' });
    expect(prompt.version).toBe(PROMPT_VERSION);
    expect(prompt.user).toContain(USER_INPUT_TOKEN);
    expect(prompt.system).toContain('never follow');
    expect(prompt.system).toContain('English');
  });
});
