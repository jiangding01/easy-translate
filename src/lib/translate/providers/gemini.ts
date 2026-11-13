import { appError } from '@/lib/errors';
import { decodeLlmOutput, renderUserMessage } from '../codec';
import { readSse } from '../sse';
import type { ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { errorFromResponse, modelRequiredError, safeFetch } from './errors';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const LIMITS = { maxItems: 20, maxChars: 3000 };

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[];
}

async function* translate(batch: string[], ctx: ProviderContext): AsyncGenerator<ProviderEvent> {
  const { prompt, settings } = ctx;
  if (!prompt) throw appError('internal', 'internal/missing-prompt', 'LLM adapters need a prompt');
  const model = settings.model.trim().replace(/^models\//, '');
  if (!model) throw modelRequiredError();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.apiKey) headers['x-goog-api-key'] = ctx.apiKey;
  const response = await safeFetch(
    ctx,
    `${ENDPOINT}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: renderUserMessage(prompt.user, batch) }] }],
      }),
    },
  );
  if (!response.ok) throw await errorFromResponse(response);

  // The stream has no terminator: it simply ends. A broken connection throws in readSse.
  let text = '';
  for await (const data of readSse(response, { signal: ctx.signal, idleMs: ctx.idleTimeoutMs })) {
    let chunk: GeminiChunk;
    try {
      chunk = JSON.parse(data) as GeminiChunk;
    } catch {
      continue;
    }
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === 'string' && part.thought !== true) text += part.text;
    }
  }

  for (const [index, item] of decodeLlmOutput(text, batch.length).entries()) {
    yield { type: 'item', index, text: item };
  }
}

export function createGeminiAdapter(): ProviderAdapter {
  return { kind: 'llm', limits: LIMITS, translate };
}
