import { describe, expect, it, vi } from 'vitest';
import { type Accent, createPhoneticLookup, lemmaCandidates, parsePhoneticTable } from './lookup';
import { shardKey } from './shard';

const GB = [
  '# ECDICT 39cfb96 · build-phonetics v3',
  'absent\tˈæbs(ə)nt',
  'are\tɑː',
  'change\ttʃeɪndʒ',
  'chang\tʃɑːŋ',
  'hello\thəˈləʊ',
  'john\tdʒɒn',
  'make\tmeɪk',
  "o'clock\təˈklɒk",
  'run\trʌn',
  'stop\tstɒp',
  'study\tˈstʌdi',
  'watch\twɒtʃ',
  'whitespace\tˈwaɪtspeɪs',
  '',
].join('\n');
const US = [
  '# ipa-dict en_US 972cd67 · build-phonetics v3',
  'are\tɑːr',
  'change\ttʃeɪndʒ',
  'hello\thəˈloʊ',
  'python\tˈpaɪθɑːn',
  'study\tˈstʌdi',
  'watch\twɑːtʃ',
  'weird\twɪrdˈ',
  '',
].join('\n');

type Answer = () => Response | Promise<Response>;

/** The tables above, sharded by two letters (as the build script does, short of splitting). */
function shardsOf(table: string): Map<string, string> {
  const shards = new Map<string, string>();
  for (const line of table.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const key = shardKey(line.slice(0, line.indexOf('\t')), 2);
    shards.set(key, `${shards.get(key) ?? ''}${line}\n`);
  }
  return shards;
}

/**
 * A lookup over the tables; `answers` replace a shard's next responses (`uk:ch`), and
 * `extra` adds lines to a table before sharding.
 */
function setup(
  answers: Record<string, Answer[]> = {},
  extra: Partial<Record<Accent, string>> = {},
  maxShards?: number,
) {
  const shards = { uk: shardsOf(`${GB}${extra.uk ?? ''}`), us: shardsOf(`${US}${extra.us ?? ''}`) };
  const queues = new Map(Object.entries(answers).map(([key, list]) => [key, [...list]]));
  const fetch = vi.fn(async (url: string) => {
    const [, accent, shard] = /^test:(uk|us)\/(.+)$/.exec(url) ?? [];
    const next = queues.get(`${accent}:${shard}`)?.shift();
    if (next) return next();
    const text = shards[accent as Accent].get(shard ?? '');
    return text === undefined ? new Response('', { status: 404 }) : new Response(text);
  });
  const lookup = createPhoneticLookup({
    fetch: fetch as unknown as typeof globalThis.fetch,
    url: (accent, shard) => `test:${accent}/${shard}`,
    shards: { uk: [...shards.uk.keys()].join(' '), us: [...shards.us.keys()].join(' ') },
    maxShards,
  });
  const calls = (key?: string) =>
    fetch.mock.calls.filter(([url]) => key === undefined || url === `test:${key.replace(':', '/')}`)
      .length;
  return { fetch, lookup, calls };
}

const failing: Answer = () => {
  throw new TypeError('Failed to fetch');
};

describe('parsePhoneticTable', () => {
  it('skips comment and blank lines', () => {
    const table = parsePhoneticTable(GB);
    expect([...table.keys()].some((key) => key.startsWith('#'))).toBe(false);
    expect(table.size).toBe(13);
    expect(table.get('are')).toBe('ɑː');
  });
});

describe('lemmaCandidates', () => {
  const stems = (word: string) => lemmaCandidates(word).map(({ stem }) => stem);

  it('tries -s before -es, so changes gives change first', () => {
    expect(lemmaCandidates('changes').slice(0, 2)).toEqual([
      { stem: 'change', suffix: 's' },
      { stem: 'chang', suffix: 's' },
    ]);
  });

  it('adds an e before trying the bare stem, unless the stem ends in a doubled consonant', () => {
    expect(stems('hoped')).toEqual(['hope', 'hop']);
    expect(stems('making')).toEqual(['make', 'mak']);
    expect(stems('added')).toEqual(['add', 'ad']);
    expect(stems('running')).toEqual(['runn', 'run']);
    expect(lemmaCandidates('studied')[0]).toEqual({ stem: 'study', suffix: 'ied' });
    expect(lemmaCandidates('studies')[2]).toEqual({ stem: 'study', suffix: 'ies' });
  });
});

describe('createPhoneticLookup', () => {
  it('finds a word in both tables, whatever its case and edges', async () => {
    const { lookup, calls } = setup();
    expect(await lookup('Hello')).toEqual({ uk: 'həˈləʊ', us: 'həˈloʊ' });
    expect(await lookup('“HELLO,”')).toEqual({ uk: 'həˈləʊ', us: 'həˈloʊ' });
    // One shard per accent, loaded once, then served from memory.
    expect(calls()).toBe(2);
    expect(calls('uk:he')).toBe(1);
    expect(await lookup('are')).toEqual({ uk: 'ɑː', us: 'ɑːr' });
    expect(calls()).toBe(4);
  });

  it('gives only the accent a table has', async () => {
    const { lookup } = setup();
    expect(await lookup('O’clock')).toEqual({ uk: 'əˈklɒk' });
    expect(await lookup('python')).toEqual({ us: 'ˈpaɪθɑːn' });
  });

  it('reads a British spelling in the American table through its American spelling', async () => {
    const { lookup } = setup(
      {},
      {
        uk: 'internationalisation\tˌɪntəˌnæʃənəlaɪˈzeɪʃən\ncolour\tˈkʌlə\n',
        us: 'internationalization\tˌɪntərˌnæʃənəlɪˈzeɪʃən\ncolor\tˈkʌlər\n',
      },
    );
    expect(await lookup('internationalisation')).toEqual({
      uk: 'ˌɪntəˌnæʃənəlaɪˈzeɪʃən',
      us: 'ˌɪntərˌnæʃənəlɪˈzeɪʃən',
    });
    // Through the rules as well: colours → colors → color.
    expect(await lookup('colours')).toEqual({ uk: 'ˈkʌləz', us: 'ˈkʌlərz' });
  });

  it('asks for no shard the list does not have', async () => {
    const { lookup, calls } = setup();
    expect(await lookup('xylophone')).toBeUndefined();
    expect(calls()).toBe(0);
  });

  it("drops a possessive 's, straight or curly", async () => {
    const { lookup } = setup();
    expect(await lookup("John's")).toEqual({ uk: 'dʒɒn' });
    expect(await lookup('John’s')).toEqual({ uk: 'dʒɒn' });
  });

  it.each([
    ['changes', { uk: 'ˈtʃeɪndʒɪz', us: 'ˈtʃeɪndʒɪz' }],
    ['changed', { uk: 'tʃeɪndʒd', us: 'tʃeɪndʒd' }],
    ['watches', { uk: 'ˈwɒtʃɪz', us: 'ˈwɑːtʃɪz' }],
    ['studies', { uk: 'ˈstʌdiz', us: 'ˈstʌdiz' }],
    ['studied', { uk: 'ˈstʌdid', us: 'ˈstʌdid' }],
    ['stopped', { uk: 'stɒpt' }],
    ['making', { uk: 'ˈmeɪkɪŋ' }],
    ['running', { uk: 'ˈrʌnɪŋ' }],
  ])('derives a regular form from its headword: %s', async (word, hit) => {
    const { lookup } = setup();
    expect(await lookup(word)).toEqual(hit);
  });

  it('finds a headword in another shard, retrying that shard after a failure', async () => {
    // With three-letter shards, "ads" (shard ads) and its headword "ad" (shard ad_) live apart.
    let failAd = true;
    const fetch = vi.fn(async (url: string) => {
      if (url === 'test:uk/ads') return new Response('adsorb\tədˈzɔːb\n');
      if (failAd) {
        failAd = false;
        throw new TypeError('Failed to fetch');
      }
      return new Response('ad\tæd\n');
    });
    const lookup = createPhoneticLookup({
      fetch: fetch as unknown as typeof globalThis.fetch,
      url: (accent, shard) => `test:${accent}/${shard}`,
      shards: { uk: 'ad_ ads', us: '' },
    });
    expect(await lookup('ads')).toBeUndefined();
    expect(await lookup('ads')).toEqual({ uk: 'ædz' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'test:uk/ads',
      'test:uk/ad_',
      'test:uk/ad_',
    ]);
  });

  it('falls back to the headword when the form cannot be derived', async () => {
    const { lookup } = setup({}, { uk: 'spy\tspaɪ(\n' });
    // A reading that ends in no known sound: shown as the headword's.
    expect(await lookup('spied')).toEqual({ uk: 'spaɪ(', lemma: 'spy' });
    expect(await lookup('weirds')).toEqual({ us: 'wɪrdˈ', lemma: 'weird' });
  });

  it("prefers the word's own reading in one accent over a headword's in the other", async () => {
    const { lookup } = setup({}, { uk: 'weirds\twɪədz\n' });
    expect(await lookup('weirds')).toEqual({ uk: 'wɪədz' });
  });

  it('uses the rules only when the word itself is missing', async () => {
    const { lookup } = setup({}, { uk: 'changes\tˈtʃeɪndʒɪs\n' });
    expect((await lookup('changes'))?.uk).toBe('ˈtʃeɪndʒɪs');
  });

  it('returns undefined for an unknown word', async () => {
    const { lookup } = setup();
    expect(await lookup('hexagon')).toBeUndefined();
    expect(await lookup('ss')).toBeUndefined();
  });

  it('never loads a shard for text that is not a word', async () => {
    const { lookup, fetch } = setup();
    for (const text of ['hello world', 'well-known', 'mp3', '', '你好', 'a'.repeat(41)]) {
      expect(await lookup(text)).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps one accent when the other fails, and retries only the failed shard', async () => {
    const { lookup, calls } = setup({
      'us:he': [failing, () => new Response('', { status: 500 })],
    });
    expect(await lookup('hello')).toEqual({ uk: 'həˈləʊ' });
    expect(await lookup('hello')).toEqual({ uk: 'həˈləʊ' });
    expect(await lookup('hello')).toEqual({ uk: 'həˈləʊ', us: 'həˈloʊ' });
    expect(await lookup('hello')).toEqual({ uk: 'həˈləʊ', us: 'həˈloʊ' });
    expect(calls('uk:he')).toBe(1);
    expect(calls('us:he')).toBe(3);
  });

  it('drops an accent whose shard fails, and tries it again next time', async () => {
    const { lookup } = setup({ 'uk:st': [failing] });
    expect(await lookup('studies')).toEqual({ us: 'ˈstʌdiz' });
    expect(await lookup('studies')).toEqual({ uk: 'ˈstʌdiz', us: 'ˈstʌdiz' });
  });

  it('returns undefined when both fail, and tries again next time', async () => {
    const { lookup } = setup({ 'uk:he': [failing], 'us:he': [failing] });
    expect(await lookup('hello')).toBeUndefined();
    expect(await lookup('hello')).toEqual({ uk: 'həˈləʊ', us: 'həˈloʊ' });
  });

  it('shares one load per shard between lookups made at the same time', async () => {
    const { lookup, calls } = setup();
    const [a, b] = await Promise.all([lookup('hello'), lookup('hello')]);
    expect(a).toEqual({ uk: 'həˈləʊ', us: 'həˈloʊ' });
    expect(b).toEqual(a);
    expect(calls()).toBe(2);
  });

  it('keeps at most maxShards per accent, dropping the least recently used', async () => {
    const { lookup, calls } = setup({}, {}, 2);
    await lookup('hello'); // he
    await lookup('john'); // jo
    await lookup('hello'); // he again: now the most recent
    await lookup('run'); // ru: jo is dropped
    expect(calls('uk:he')).toBe(1);
    await lookup('hello');
    expect(calls('uk:he')).toBe(1);
    await lookup('john');
    expect(calls('uk:jo')).toBe(2);
  });

  it('defaults to the packaged shards and the generated list', async () => {
    const fetch = vi.fn(async (_url: string) => new Response('hello\thəˈləʊ\n'));
    const lookup = createPhoneticLookup({ fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await lookup('hello')).toEqual({ uk: 'həˈləʊ', us: 'həˈləʊ' });
    const urls = fetch.mock.calls.map(([url]) => String(url)).sort();
    expect(urls[0]).toMatch(/\/dict\/gb\/he\.tsv$/);
    expect(urls[1]).toMatch(/\/dict\/us\/he\.tsv$/);
  });
});
