/**
 * Long-lived Port served by the background: req → chunk* → done (see lib/messaging/port).
 * Lives in its own side-effect-free file so the on-demand page runtime can import it
 * without pulling in `protocol.ts` (which creates the messaging singleton).
 */
export const TRANSLATE_PORT_NAME = 'et-translate';
