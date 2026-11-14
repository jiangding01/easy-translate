import { vi } from 'vitest';
import type { ProviderContext, ProviderEvent } from './types';

export const PROMPT = { system: 'SYS', user: 'USER <<INPUT>>', version: 1 };

export function makeCtx(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return {
    signal: new AbortController().signal,
    source: 'auto',
    target: 'zh-CN',
    settings: { baseURL: 'https://api.example.com/v1', model: 'm' },
    apiKey: 'sk-secret-key',
    prompt: PROMPT,
    fetch: vi.fn() as unknown as typeof fetch,
    ...overrides,
  };
}

export async function collect(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

export function streamOf(chunks: string[], failWith?: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk !== undefined) {
        index += 1;
        controller.enqueue(encoder.encode(chunk));
      } else if (failWith) {
        controller.error(failWith);
      } else {
        controller.close();
      }
    },
  });
}

export function sseResponse(chunks: string[], failWith?: Error, status = 200): Response {
  return new Response(streamOf(chunks, failWith), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export function mockFetch(...responses: (Response | Error)[]) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  return fn as typeof fn & typeof fetch;
}
