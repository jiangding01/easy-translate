import { describe, expect, it, vi } from 'vitest';
import { type AutoStartDeps, startIfRemembered } from './auto-start';

describe('startIfRemembered', () => {
  const deps = (memory: unknown): AutoStartDeps & { start: ReturnType<typeof vi.fn> } => ({
    origin: 'https://example.com',
    readMemory: async () => memory,
    start: vi.fn(async () => {}),
  });

  it('starts for a remembered site only', async () => {
    const yes = deps({ 'https://example.com': { always: true } });
    expect(await startIfRemembered(yes)).toBe(true);
    expect(yes.start).toHaveBeenCalledTimes(1);

    for (const other of [
      deps(undefined),
      deps({ 'https://other.com': { always: true } }),
      deps({ 'https://example.com': { always: false } }),
    ]) {
      expect(await startIfRemembered(other)).toBe(false);
      expect(other.start).not.toHaveBeenCalled();
    }
  });
});
