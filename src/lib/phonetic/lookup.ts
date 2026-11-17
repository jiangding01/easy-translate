import { browser } from 'wxt/browser';
import { deriveForm, type InflectionSuffix } from './derive';
import { shardFor } from './shard';
import { SHARDS } from './shards.generated';
import { americanSpellings } from './spelling';
import { phoneticKey } from './word';

// British and American IPA for single English words, from the bundled sharded tables
// public/dict/gb/<shard>.tsv and public/dict/us/<shard>.tsv (built by
// scripts/build-phonetics.mjs from ECDICT and ipa-dict). Background only: a shard is read
// with the extension's own fetch when a word (or a headword the rules try) needs it, and kept
// in memory, at most MAX_SHARDS per accent, the least recently used dropped first. A failed
// load is not remembered (the next lookup tries again), one accent failing never affects the
// other, and nothing here throws.

export type Accent = 'uk' | 'us';

const ACCENTS: Accent[] = ['uk', 'us'];
const DIRS: Record<Accent, string> = { uk: 'gb', us: 'us' };

/** Shards kept in memory per accent. */
export const MAX_SHARDS = 128;

export interface PhoneticHit {
  uk?: string;
  us?: string;
  /** Set when the readings are the headword's: the form's own could not be derived. */
  lemma?: string;
}

export type LookupPhonetic = (text: string) => Promise<PhoneticHit | undefined>;

export interface PhoneticLookupDeps {
  fetch?: typeof fetch;
  /** A shard's address; defaults to the packaged file. */
  url?: (accent: Accent, shard: string) => string;
  /** The shards that exist, space-separated per accent; defaults to the generated list. */
  shards?: Record<Accent, string>;
  maxShards?: number;
}

/** `word\tipa` lines; `#` lines are comments. */
export function parsePhoneticTable(text: string): Map<string, string> {
  const table = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const ipa = line.slice(tab + 1).trim();
    if (ipa) table.set(line.slice(0, tab), ipa);
  }
  return table;
}

export interface LemmaCandidate {
  stem: string;
  suffix: InflectionSuffix;
}

/**
 * Headwords a regular inflection may come from, in the order tried: -s, -es, -ies → y,
 * -ied → y, then -ed and -ing. A stem ending in a doubled consonant is tried as it is, then
 * undoubled (added → add, stopped → stop, running → run); any other stem with an e added
 * first, then as it is (changed → change, not chang; hoped → hope, not hop; played → play).
 */
export function lemmaCandidates(word: string): LemmaCandidate[] {
  const out: LemmaCandidate[] = [];
  const add = (stem: string, suffix: InflectionSuffix) => {
    if (stem.length >= 2 && !out.some((candidate) => candidate.stem === stem)) {
      out.push({ stem, suffix });
    }
  };
  if (word.endsWith('s')) add(word.slice(0, -1), 's');
  if (word.endsWith('es')) add(word.slice(0, -2), 's');
  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`, 'ies');
  if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`, 'ied');
  for (const suffix of ['ed', 'ing'] as const) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) {
      add(stem, suffix);
      add(stem.slice(0, -1), suffix);
    } else {
      add(`${stem}e`, suffix);
      add(stem, suffix);
    }
  }
  return out;
}

interface Reading {
  ipa: string;
  lemma?: string;
}

/** A failed shard load: the accent has no answer this time. */
const FAILED = Symbol('failed');
type Get = (word: string) => Promise<string | undefined | typeof FAILED>;

/** The word's reading in one accent: its own, derived from its headword's, or the headword's. */
async function readIn(get: Get, word: string): Promise<Reading | undefined | typeof FAILED> {
  const ipa = await get(word);
  if (ipa === FAILED) return FAILED;
  if (ipa !== undefined) return { ipa };
  for (const { stem, suffix } of lemmaCandidates(word)) {
    const found = await get(stem);
    if (found === FAILED) return FAILED;
    if (found === undefined) continue;
    const derived = deriveForm(found, suffix, stem);
    return derived ? { ipa: derived } : { ipa: found, lemma: stem };
  }
  return undefined;
}

export function createPhoneticLookup(deps: PhoneticLookupDeps = {}): LookupPhonetic {
  const url =
    deps.url ??
    ((accent: Accent, shard: string) =>
      (browser.runtime.getURL as (path: string) => string)(`/dict/${DIRS[accent]}/${shard}.tsv`));
  const listed = {
    uk: new Set((deps.shards ?? SHARDS).uk.split(' ')),
    us: new Set((deps.shards ?? SHARDS).us.split(' ')),
  };
  const maxShards = deps.maxShards ?? MAX_SHARDS;
  /** Loaded shards per accent, least recently used first. */
  const cache = {
    uk: new Map<string, Map<string, string>>(),
    us: new Map<string, Map<string, string>>(),
  };
  const loading = {
    uk: new Map<string, Promise<Map<string, string> | undefined>>(),
    us: new Map<string, Promise<Map<string, string> | undefined>>(),
  };

  async function fetchShard(
    accent: Accent,
    shard: string,
  ): Promise<Map<string, string> | undefined> {
    try {
      const response = await (deps.fetch ?? fetch)(url(accent, shard));
      if (!response.ok) return undefined;
      return parsePhoneticTable(await response.text());
    } catch {
      return undefined;
    }
  }

  function load(accent: Accent, shard: string): Promise<Map<string, string> | undefined> {
    const shards = cache[accent];
    const kept = shards.get(shard);
    if (kept) {
      // Most recently used goes last.
      shards.delete(shard);
      shards.set(shard, kept);
      return Promise.resolve(kept);
    }
    const pending = loading[accent];
    let promise = pending.get(shard);
    if (!promise) {
      promise = fetchShard(accent, shard).then((table) => {
        pending.delete(shard);
        if (table) {
          shards.set(shard, table);
          for (const old of shards.keys()) {
            if (shards.size <= maxShards) break;
            shards.delete(old);
          }
        }
        return table;
      });
      pending.set(shard, promise);
    }
    return promise;
  }

  const getter =
    (accent: Accent): Get =>
    async (word) => {
      const shard = shardFor(word, listed[accent]);
      if (shard === undefined) return undefined;
      const table = await load(accent, shard);
      return table ? table.get(word) : FAILED;
    };

  return async (text) => {
    const word = phoneticKey(text);
    if (word === undefined) return undefined;
    const found = await Promise.all(
      ACCENTS.map(async (accent) => {
        const get = getter(accent);
        const reading = await readIn(get, word);
        if (reading !== undefined || accent !== 'us') return reading;
        // A British spelling the American table lacks: its American spelling reads the same.
        for (const variant of americanSpellings(word)) {
          const found = await readIn(get, variant);
          if (found !== undefined) return found;
        }
        return undefined;
      }),
    );
    const readings = ACCENTS.map((accent, index) => {
      const reading = found[index];
      return { accent, reading: reading === FAILED ? undefined : reading };
    });
    // The word's own readings win; headword readings only when there is nothing else, and
    // then only those of one headword (the British one's, when both exist).
    const own = readings.filter(({ reading }) => reading && !reading.lemma);
    const lemma = readings.find(({ reading }) => reading?.lemma)?.reading?.lemma;
    const shown = own.length > 0 ? own : readings.filter(({ reading }) => reading?.lemma === lemma);
    if (shown.length === 0 || !shown[0]?.reading) return undefined;
    const hit: PhoneticHit = {};
    for (const { accent, reading } of shown) if (reading) hit[accent] = reading.ipa;
    if (own.length === 0 && lemma) hit.lemma = lemma;
    return hit;
  };
}
