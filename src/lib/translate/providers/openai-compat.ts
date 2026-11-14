import { isLocalEndpoint } from '@/lib/endpoint';
import { appError } from '@/lib/errors';
import { decodeLlmOutput, renderUserMessage } from '../codec';
import { readSse } from '../sse';
import type { ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import {
  contentBlockedError,
  errorFromResponse,
  interruptedError,
  modelRequiredError,
  outputTruncatedError,
  safeFetch,
} from './errors';

const LIMITS = { maxItems: 20, maxChars: 3000 };

interface StreamChunk {
  error?: unknown;
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
}

async function* translate(batch: string[], ctx: ProviderContext): AsyncGenerator<ProviderEvent> {
  const { prompt, settings } = ctx;
  if (!prompt) throw appError('internal', 'internal/missing-prompt', 'LLM adapters need a prompt');
  if (!settings.model.trim()) throw modelRequiredError();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.apiKey) headers.Authorization = `Bearer ${ctx.apiKey}`;
  const response = await safeFetch(ctx, `${settings.baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: renderUserMessage(prompt.user, batch) },
      ],
    }),
  });
  if (!response.ok) {
    // Local servers (Ollama) answer 403 to an extension origin they do not allow;
    // that is a setup step, not a bad key.
    if (response.status === 403 && isLocalEndpoint(settings.baseURL)) {
      throw appError('provider', 'provider/local-origin-rejected', 'HTTP 403 from a local server');
    }
    throw await errorFromResponse(response);
  }

  let text = '';
  let finished = false;
  for await (const data of readSse(response, { signal: ctx.signal, idleMs: ctx.idleTimeoutMs })) {
    if (data === '[DONE]') {
      finished = true;
      break;
    }
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      continue;
    }
    if (chunk.error) {
      throw appError('provider', 'provider/server-error', 'Provider reported a stream error', {
        retryable: true,
      });
    }
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
    if (choice?.finish_reason === 'length') throw outputTruncatedError();
    if (choice?.finish_reason === 'content_filter') throw contentBlockedError();
    if (choice?.finish_reason) finished = true;
  }
  if (!finished) throw interruptedError();

  for (const [index, item] of decodeLlmOutput(text, batch.length).entries()) {
    yield { type: 'item', index, text: item };
  }
}

export function createOpenAICompatAdapter(): ProviderAdapter {
  return { kind: 'llm', limits: LIMITS, translate };
}
