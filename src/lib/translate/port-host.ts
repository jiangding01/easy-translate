import { type PortLike, servePort } from '@/lib/messaging/port';
import type { TranslateChunk, TranslateDone, TranslateRequest } from '@/lib/messaging/protocol';
import type { TranslateService } from './service';

/**
 * Returns the `onConnect` body for the translate Port. Each accepted port gets
 * its own caller id, so the scheduler can round-robin between tabs; `listenPort`
 * cannot be used because its handler never sees which port a request came from.
 */
export function createTranslatePortHost(
  service: Pick<TranslateService, 'translate'>,
  portName: string,
) {
  let sequence = 0;
  return (port: PortLike & { name: string }) => {
    if (port.name !== portName) return;
    const caller = `port-${++sequence}`;
    servePort<TranslateRequest, TranslateChunk, TranslateDone>(port, (payload, ctx) =>
      service.translate(payload, { ...ctx, caller }),
    );
  };
}
