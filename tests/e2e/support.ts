import { expect } from 'vitest';
import type { Harness } from './harness';

// Shared set-up for the smoke cases: settings that must not depend on the system language.

/** From the settings page: pins the target language and (optionally) empties the cache. */
export async function prepare(h: Harness, { clearCache = false, target = 'zh-CN' } = {}) {
  const options = await h.extPage('options.html');
  expect(
    await options.send('config.patch', [{ path: 'language.target', value: target }]),
  ).toMatchObject({ ok: true });
  if (clearCache) expect(await options.send('cache.clear')).toMatchObject({ ok: true });
  await options.close();
}

export interface PageState {
  phase: string;
  mode: string;
  translated: number;
  failed: number;
  /** Set while the session is paused on an engine-level error. */
  engineError?: { code: string };
}

/** What a page message resolves to when it worked. */
export type Ok<T> = { ok: true; data: T };
