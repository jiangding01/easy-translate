import { type AppError, isAppError } from '@/lib/errors';
import type { ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { badResponseError, errorFromResponse, safeFetch } from './errors';

const BASE = 'https://translate.googleapis.com/translate_a';
const LIMITS = { maxItems: 50, maxChars: 5000 };
/** The GET fallback shares the URL length ceiling; above this Google answers 429. */
const SINGLE_MAX_ENCODED_BYTES = 6000;

type Attempt = { ok: true; texts: string[] } | { ok: false; error: AppError; fallback: boolean };

function query(ctx: ProviderContext): string {
  return `client=gtx&sl=${encodeURIComponent(ctx.source)}&tl=${encodeURIComponent(ctx.target)}`;
}

/** Reads the shapes translate_a/t returns; undefined when unrecognizable. */
function readRows(json: unknown, count: number): string[] | undefined {
  if (typeof json === 'string') return [json];
  if (!Array.isArray(json)) return undefined;
  if (json.every((row) => typeof row === 'string')) {
    // One item may come back as ["text", "detected-lang"].
    return count === 1 ? [json[0] as string] : (json as string[]);
  }
  const rows: string[] = [];
  for (const row of json) {
    const text = Array.isArray(row) ? row[0] : row;
    if (typeof text !== 'string') return undefined;
    rows.push(text);
  }
  return rows;
}

async function primary(batch: string[], ctx: ProviderContext): Promise<Attempt> {
  const body = new URLSearchParams();
  for (const text of batch) body.append('q', text);
  let response: Response;
  try {
    response = await safeFetch(ctx, `${BASE}/t?${query(ctx)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    });
  } catch (error) {
    if (!isAppError(error)) throw error;
    return { ok: false, error, fallback: error.code === 'network/fetch-failed' };
  }
  if (!response.ok) {
    const { status } = response;
    const fallback = status === 403 || status === 404 || status >= 500;
    return { ok: false, error: await errorFromResponse(response), fallback };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: badResponseError(), fallback: true };
  }
  const rows = readRows(json, batch.length);
  if (!rows) return { ok: false, error: badResponseError(), fallback: true };
  if (rows.length !== batch.length) {
    return { ok: false, error: badResponseError('Item count mismatch'), fallback: false };
  }
  return { ok: true, texts: rows };
}

async function single(text: string, ctx: ProviderContext): Promise<string> {
  const url = `${BASE}/single?${query(ctx)}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await safeFetch(ctx, url, { method: 'GET' });
  if (!response.ok) throw await errorFromResponse(response);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw badResponseError();
  }
  const segments = Array.isArray(json) ? json[0] : undefined;
  if (!Array.isArray(segments)) throw badResponseError();
  let result = '';
  for (const segment of segments) {
    if (!Array.isArray(segment) || typeof segment[0] !== 'string') throw badResponseError();
    result += segment[0];
  }
  return result;
}

async function* translate(batch: string[], ctx: ProviderContext): AsyncGenerator<ProviderEvent> {
  const attempt = await primary(batch, ctx);
  if (attempt.ok) {
    for (const [index, text] of attempt.texts.entries()) yield { type: 'item', index, text };
    return;
  }
  if (!attempt.fallback) throw attempt.error;
  // An oversized GET would be answered with 429, so those items fail as-is.
  if (batch.some((text) => encodeURIComponent(text).length > SINGLE_MAX_ENCODED_BYTES)) {
    throw attempt.error;
  }
  const texts: string[] = [];
  for (const text of batch) texts.push(await single(text, ctx));
  for (const [index, text] of texts.entries()) yield { type: 'item', index, text };
}

export function createGoogleAdapter(): ProviderAdapter {
  return { kind: 'mt', limits: LIMITS, translate };
}
