import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MAX_REPAIR_ROUNDS, parseStoredConfig } from './parse';
import { configSchema } from './schema';

const uiLanguage = 'ja-JP';
const defaults = { ui: { theme: 'system' }, language: { target: 'ja' } };
const stored = (data: unknown) => ({ schemaVersion: 1, data });
const parse = (raw: unknown) => parseStoredConfig(raw, { uiLanguage });

describe('parseStoredConfig', () => {
  it.each([undefined, null, 'x', 42, []])('returns defaults for %j and marks repaired', (raw) => {
    const result = parse(raw);
    expect(result.snapshot).toEqual({ schemaVersion: 1, data: defaults });
    expect(result.repaired).toBe(true);
    expect(result.readOnly).toBe(false);
  });

  it('keeps valid data as-is without marking repaired', () => {
    const data = { ui: { theme: 'dark' }, language: { target: 'ko' } };
    const result = parse(stored(data));
    expect(result.snapshot.data).toEqual(data);
    expect(result.repaired).toBe(false);
    expect(result.resetPaths).toEqual([]);
  });

  it('preserves unknown keys at every level', () => {
    const data = {
      ui: { theme: 'dark', density: 'compact' },
      language: { target: 'en' },
      future: 1,
    };
    const result = parse(stored(data));
    expect(result.snapshot.data).toEqual(data);
    expect(result.repaired).toBe(false);
  });

  it('fills missing fields with defaults and marks repaired', () => {
    const result = parse(stored({ ui: { theme: 'dark' } }));
    expect(result.snapshot.data).toEqual({ ui: { theme: 'dark' }, language: { target: 'ja' } });
    expect(result.repaired).toBe(true);
  });

  it('resets only the invalid leaf', () => {
    const result = parse(stored({ ui: { theme: 'neon', keep: true }, language: { target: 'ko' } }));
    expect(result.snapshot.data).toEqual({
      ui: { theme: 'system', keep: true },
      language: { target: 'ko' },
    });
    expect(result.repaired).toBe(true);
    expect(result.resetPaths).toEqual(['ui.theme']);
  });

  it('resets several invalid leaves independently', () => {
    const result = parse(stored({ ui: { theme: 1 }, language: { target: 'xx', keep: 'y' } }));
    expect(result.snapshot.data).toEqual({
      ui: { theme: 'system' },
      language: { target: 'ja', keep: 'y' },
    });
    expect(result.resetPaths.sort()).toEqual(['language.target', 'ui.theme']);
  });

  it('replaces a parent of the wrong type with its default subtree', () => {
    const result = parse(stored({ ui: 'x', language: { target: 'ko' } }));
    expect(result.snapshot.data).toEqual({ ui: { theme: 'system' }, language: { target: 'ko' } });
    expect(result.resetPaths).toEqual(['ui']);
  });

  it('resets everything for a root-level issue', () => {
    const result = parse(stored('not an object'));
    expect(result.snapshot.data).toEqual(defaults);
    expect(result.resetPaths).toEqual(['']);
    expect(result.fallback).toBe(false);
  });

  it('drops only the invalid array elements', () => {
    const schema = configSchema.extend({
      styles: z.array(z.object({ name: z.string() })),
    });
    const result = parseStoredConfig(
      stored({ ...defaults, styles: [{ name: 'a' }, { name: 1 }, 'bad', { name: 'b' }] }),
      { uiLanguage, schema },
    );
    expect(result.snapshot.data).toMatchObject({ styles: [{ name: 'a' }, { name: 'b' }] });
    expect(result.resetPaths.sort()).toEqual(['styles.1.name', 'styles.2']);
  });

  it(`falls back to defaults after ${MAX_REPAIR_ROUNDS} rounds that do not converge`, () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const schema = configSchema.superRefine((_value, ctx) => {
      ctx.addIssue({ code: 'custom', message: 'never valid', path: ['ui', 'theme'] });
    });
    const result = parseStoredConfig(stored(defaults), { uiLanguage, schema });
    expect(result.fallback).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.snapshot.data).toEqual(defaults);
    expect(result.resetPaths).toHaveLength(MAX_REPAIR_ROUNDS);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('enters read-only mode for a newer schemaVersion', () => {
    const result = parse({ schemaVersion: 2, data: { whatever: true } });
    expect(result.readOnly).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.snapshot.data).toEqual(defaults);
  });

  it('treats a missing schemaVersion as needing a write-back', () => {
    const result = parse({ data: { ui: { theme: 'dark' }, language: { target: 'en' } } });
    expect(result.snapshot.data).toEqual({ ui: { theme: 'dark' }, language: { target: 'en' } });
    expect(result.repaired).toBe(true);
  });
});
