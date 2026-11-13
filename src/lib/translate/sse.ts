import { isAppError } from '@/lib/errors';
import { abortedError, fetchFailedError, timeoutError } from './providers/errors';

export interface SseOptions {
  signal?: AbortSignal;
  /** Fail when no bytes arrive for this long. Starts only after the first chunk. */
  idleMs?: number;
}

/** Resolves with the next chunk, or rejects with a timeout; always clears its timer. */
async function readWithIdle(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (idleMs === undefined) return reader.read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), idleMs);
  });
  try {
    return await Promise.race([reader.read(), idle]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Yields the `data` payload of each server-sent event. Handles LF/CR/CRLF,
 * comments, multi-line data and events split across chunks. Cancels the body
 * when the consumer stops early, on abort and on idle timeout.
 */
export async function* readSse(
  response: Response,
  options: SseOptions = {},
): AsyncGenerator<string, void> {
  const body = response.body;
  if (!body) throw fetchFailedError();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let received = false;

  function* flushEvent(): Generator<string> {
    if (dataLines.length > 0) {
      const data = dataLines.join('\n');
      dataLines = [];
      yield data;
    }
  }

  function* processLine(line: string): Generator<string> {
    if (line === '') {
      yield* flushEvent();
    } else if (line.startsWith(':')) {
      // comment / keep-alive
    } else {
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') dataLines.push(value);
    }
  }

  try {
    for (;;) {
      if (options.signal?.aborted) throw abortedError();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await readWithIdle(reader, received ? options.idleMs : undefined);
      } catch (error) {
        if (isAppError(error)) throw error;
        throw options.signal?.aborted ? abortedError() : fetchFailedError();
      }
      if (chunk.done) break;
      received = true;
      buffer += decoder.decode(chunk.value, { stream: true });
      // A trailing CR may be the first half of a CRLF split across chunks.
      const hold = buffer.endsWith('\r') ? 1 : 0;
      const complete = buffer.slice(0, buffer.length - hold);
      const lines = complete.split(/\r\n|\n|\r/);
      buffer = lines.pop() + buffer.slice(buffer.length - hold);
      for (const line of lines) yield* processLine(line);
    }
    buffer += decoder.decode();
    for (const line of buffer.split(/\r\n|\n|\r/)) yield* processLine(line);
    yield* flushEvent();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
