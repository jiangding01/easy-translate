import { readSiteMemory, siteEntry } from '@/lib/site-memory';

// "总是翻译此站": the resident part only checks the site memory. Whether the page is
// already in the target language is decided by the page runtime (session.autoStart).

export interface AutoStartDeps {
  origin: string;
  /** The raw `storage.local.siteMemory` value. */
  readMemory(): Promise<unknown>;
  start(): Promise<unknown>;
}

/** On page load: start (through the page runtime) only for a remembered site. */
export async function startIfRemembered(deps: AutoStartDeps): Promise<boolean> {
  const entry = siteEntry(readSiteMemory(await deps.readMemory()), deps.origin);
  if (!entry?.always) return false;
  await deps.start();
  return true;
}
