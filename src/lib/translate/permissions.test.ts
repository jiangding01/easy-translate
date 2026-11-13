import { describe, expect, it, vi } from 'vitest';
import { checkEndpointPermission, parseEndpointOrigin } from './permissions';

describe('parseEndpointOrigin', () => {
  it('extracts and normalizes the origin pattern', () => {
    expect(parseEndpointOrigin('https://api.example.com/v1/chat/completions/')).toEqual({
      ok: true,
      data: { pattern: 'https://api.example.com/*', origin: 'https://api.example.com' },
    });
  });

  it.each(['http://localhost:11434/v1', 'http://127.0.0.1:8080'])(
    'allows local http: %s',
    (url) => {
      expect(parseEndpointOrigin(url).ok).toBe(true);
    },
  );

  it('drops the port from the match pattern', () => {
    const result = parseEndpointOrigin('http://localhost:11434/v1');
    expect(result).toMatchObject({ ok: true, data: { pattern: 'http://localhost/*' } });
  });

  it.each([
    'http://example.com/v1',
    'ftp://example.com',
    'not a url',
    '',
    'http://localhost.evil.com',
  ])('rejects %j', (url) => {
    expect(parseEndpointOrigin(url)).toMatchObject({
      ok: false,
      error: { code: 'config/invalid-base-url' },
    });
  });
});

describe('checkEndpointPermission', () => {
  it('returns permission-missing without the grant, without making requests', async () => {
    const contains = vi.fn(async () => false);
    const result = await checkEndpointPermission('https://api.example.com/v1', { contains });
    expect(contains).toHaveBeenCalledWith(['https://api.example.com/*']);
    expect(result).toMatchObject({ ok: false, error: { code: 'config/permission-missing' } });
  });

  it('treats a throwing permissions API as not granted', async () => {
    const result = await checkEndpointPermission('https://a.com', {
      contains: async () => {
        throw new Error('x');
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'config/permission-missing' } });
  });

  it('succeeds when granted', async () => {
    const result = await checkEndpointPermission('https://a.com/v1', {
      contains: async () => true,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid URL before asking the browser', async () => {
    const contains = vi.fn(async () => true);
    const result = await checkEndpointPermission('http://a.com', { contains });
    expect(result).toMatchObject({ ok: false, error: { code: 'config/invalid-base-url' } });
    expect(contains).not.toHaveBeenCalled();
  });
});
