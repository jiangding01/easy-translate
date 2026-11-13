import { type AppError, isAppError } from '@/lib/errors';
import { badResponseError } from './providers/errors';

// LLM batch protocol: input and output are JSON arrays of { i, t }, matched by `i`.

/** Placeholder in BuiltPrompt.user that is replaced by the encoded batch. */
export const USER_INPUT_TOKEN = '<<INPUT>>';

export function encodeBatch(texts: readonly string[]): string {
  return JSON.stringify(texts.map((t, i) => ({ i, t })));
}

export function renderUserMessage(template: string, texts: readonly string[]): string {
  return template.split(USER_INPUT_TOKEN).join(encodeBatch(texts));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArray(text: string): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Tolerates Markdown fences and prose around the array. */
function extractArray(raw: string): unknown[] | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  for (const candidate of [fenced, raw]) {
    if (candidate === undefined) continue;
    const direct = parseArray(candidate.trim());
    if (direct) return direct;
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start !== -1 && end > start) {
      const sliced = parseArray(candidate.slice(start, end + 1));
      if (sliced) return sliced;
    }
  }
  return undefined;
}

/**
 * Parses model output into translations ordered by input position. Order in the
 * output does not matter; ids must be exactly 0..count-1, unique, with non-empty text.
 * Throws `validation/bad-response`.
 */
export function decodeLlmOutput(raw: string, count: number): string[] {
  const entries = extractArray(raw);
  if (!entries) throw badResponseError('Output is not a JSON array');
  if (entries.length !== count) throw badResponseError('Item count mismatch');
  const result: (string | undefined)[] = new Array(count).fill(undefined);
  for (const entry of entries) {
    if (!isRecord(entry)) throw badResponseError('Malformed item');
    const { i, t } = entry;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= count) {
      throw badResponseError('Item id out of range');
    }
    if (result[i] !== undefined) throw badResponseError('Duplicate item id');
    if (typeof t !== 'string' || t.trim() === '') throw badResponseError('Empty translation');
    result[i] = t;
  }
  return result as string[];
}

/** Greedy grouping by item and character limits; returns index groups in order. */
export function chunkByLimits(
  texts: readonly string[],
  limits: { maxItems: number; maxChars: number },
): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  texts.forEach((text, index) => {
    const length = text.length;
    if (
      current.length > 0 &&
      (current.length >= limits.maxItems || chars + length > limits.maxChars)
    ) {
      groups.push(current);
      current = [];
      chars = 0;
    }
    current.push(index);
    chars += length;
  });
  if (current.length > 0) groups.push(current);
  return groups;
}

export function splitInHalf<T>(items: readonly T[]): [T[], T[]] | undefined {
  if (items.length < 2) return undefined;
  const middle = Math.ceil(items.length / 2);
  return [items.slice(0, middle), items.slice(middle)];
}

export type ItemOutcome = { ok: true; text: string } | { ok: false; error: AppError };

/**
 * Runs `run` on the batch; when the result is malformed (`validation/bad-response`),
 * halves the batch and retries each half down to single items. Other errors apply
 * to every item in the batch. Pure helper: callers route `run` through the scheduler.
 */
export async function settleWithSplit<T>(
  items: readonly T[],
  run: (items: readonly T[]) => Promise<string[]>,
): Promise<ItemOutcome[]> {
  try {
    const texts = await run(items);
    if (texts.length !== items.length) throw badResponseError('Item count mismatch');
    return texts.map((text) => ({ ok: true, text }));
  } catch (error) {
    const appErr = isAppError(error) ? error : badResponseError();
    const halves = appErr.code === 'validation/bad-response' ? splitInHalf(items) : undefined;
    if (!halves) return items.map(() => ({ ok: false, error: appErr }));
    const left = await settleWithSplit(halves[0], run);
    const right = await settleWithSplit(halves[1], run);
    return [...left, ...right];
  }
}
