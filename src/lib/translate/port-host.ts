import { type PortLike, type ServePortOptions, servePort } from '@/lib/messaging/port';
import type { TranslateChunk, TranslateDone, TranslateRequest } from '@/lib/messaging/protocol';
import type { TranslateService } from './service';

/**
 * Returns the `onConnect` body for the translate Port. Each accepted port gets
 * its own caller id, so the scheduler can round-robin between tabs; `listenPort`
 * cannot be used because its handler never sees which port a request came from.
 *
 * `decorateError` sees every error leaving the port: error frames (via `servePort`) and
 * per-item chunk errors, which carry most provider failures.
 */
export function createTranslatePortHost(
  service: Pick<TranslateService, 'translate'>,
  portName: string,
  options: ServePortOptions = {},
) {
  const { decorateError } = options;
  let sequence = 0;
  return (port: PortLike & { name: string }) => {
    if (port.name !== portName) return;
    const caller = `port-${++sequence}`;
    servePort<TranslateRequest, TranslateChunk, TranslateDone>(
      port,
      (payload, ctx) => {
        const emit: (chunk: TranslateChunk) => void = decorateError
          ? (chunk) =>
              ctx.emit('error' in chunk ? { ...chunk, error: decorateError(chunk.error) } : chunk)
          : ctx.emit;
        return service.translate(payload, { ...ctx, emit, caller });
      },
      options,
    );
  };
}
