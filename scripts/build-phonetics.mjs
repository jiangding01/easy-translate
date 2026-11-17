// Builds the sharded phonetic tables from local copies of the sources:
//   public/dict/gb/<shard>.tsv  word → British IPA (ECDICT)
//   public/dict/us/<shard>.tsv  word → American IPA (ipa-dict en_US)
//   public/dict/SOURCES.txt     where the data comes from
//   src/lib/phonetic/shards.generated.ts  the list of shards, imported by the background
// Usage: node scripts/build-phonetics.mjs <path/to/ecdict.csv> <path/to/en_US.txt>
//
// Sources (licenses in public/dict/):
// - ECDICT, https://github.com/skywind3000/ECDICT at commit 39cfb96 (MIT).
// - ipa-dict en_US, https://github.com/open-dict-data/ipa-dict at commit 972cd67 (MIT), built
//   from lingz/cmudict-ipa (MIT) on the CMU Pronouncing Dictionary (BSD-style).
// Offline and dependency-free; the notation rules come from src/lib/phonetic/notation.ts and
// the shard names from src/lib/phonetic/shard.ts, imported directly, which needs Node's
// TypeScript type stripping (on by default since Node 22.18 / 23.6; on 22.12–22.17 run with
// --experimental-strip-types).
//
// British words: every ECDICT entry of letters with a usable phonetic. Keys are lowercase:
// all-caps entries (abbreviations) and capitalized ones are kept only when ranked
// (min(frq, bnc) ignoring 0); entries with spaces, digits or hyphens are skipped, and so are
// apostrophes except in three common words; words whose reading lacks their regular ending
// (-s, -ed, -ing, -est: mostly inflections that repeat their headword's reading) are left out,
// and the lookup derives them. American words: every en_US entry of
// letters (same three apostrophe words). A few words are added or replaced by hand.
//
// Shards: a key's first two letters (`a_` for a one-letter word, `_` for anything but a-z).
// A shard over 40KB gzipped is split by the first three letters instead.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { toIpa, toUsIpa } from '../src/lib/phonetic/notation.ts';
import { shardKey } from '../src/lib/phonetic/shard.ts';

const VERSION = 'v4';
const COMMIT = '39cfb9672c0906b63569e0453c2e6abfb9ab182a';
const US_COMMIT = '972cd67dd5f96bc5660e28070cde26e3928abcd7';
/** Shards larger than this (gzip) are split by three letters. */
const SHARD_LIMIT = 40 * 1024;
const UNRANKED = Number.POSITIVE_INFINITY;
const APOSTROPHE_WORDS = new Set(["o'clock", "ma'am", "y'all"]);
/** Always included when ECDICT has a usable phonetic (high-frequency in technical text). */
const EXTRA_WORDS = [
  'python',
  'callback',
  'asynchronous',
  'indentation',
  'whitespace',
  'instantiation',
];
/** Entries ECDICT lacks or gets wrong, in ECDICT's own notation (converted like the rest). */
const MANUAL = { are: 'ɑ:' };
/** en_US readings replaced (its first reading of `the` is the stressed one, ˈðə → ðʌ). */
const MANUAL_US = new Map([['the', '/ðə/']]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [input, usInput] = process.argv.slice(2);
if (!input || !usInput) {
  console.error('Usage: node scripts/build-phonetics.mjs <path/to/ecdict.csv> <path/to/en_US.txt>');
  process.exit(1);
}

/** RFC 4180 rows (quoted fields may hold commas, quotes and newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rankOf(entry) {
  const ranks = [entry.frq, entry.bnc].map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return ranks.length > 0 ? Math.min(...ranks) : UNRANKED;
}

/** 0 lowercase, 1 capitalized, 2 all caps; undefined when the spelling is never kept. */
function caseClass(word) {
  const lower = word.toLowerCase();
  const shapeOk = /^[a-z]+$/.test(lower) || APOSTROPHE_WORDS.has(lower);
  if (!shapeOk) return undefined;
  if (word === lower) return 0;
  if (word.length > 1 && word === word.toUpperCase()) return 2;
  if (word.slice(1) === word.slice(1).toLowerCase()) return 1;
  return undefined;
}

const [header, ...body] = parseCsv(await readFile(input, 'utf8'));
const entries = body
  .filter((cells) => cells.length >= header.length)
  .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])));

/**
 * ECDICT gives many inflections their headword's reading (`ambled` ˈæmb(ə)l, `arbuscules`
 * ˈɑːbəskjʊl), often without saying they are inflections. A regular ending must show in the
 * reading; when it does not, the word is left out and the lookup derives it from its
 * headword instead. Common words with a silent final s are kept by name.
 */
const SILENT_S = new Set([
  'arkansas',
  'bourgeois',
  'bruges',
  'calais',
  'cannes',
  'chamois',
  'chassis',
  'corps',
  'debris',
  'illinois',
  'les',
  'louis',
  'mas',
  'pas',
  'rendezvous',
  'versailles',
]);
const ENDINGS = [
  [/ing$/, /ŋ$/],
  [/ed$/, /[td]$/],
  [/est$/, /st$/],
  [/[^s]s$/, /[sz]$/],
];
function plausible(key, ipa) {
  if (SILENT_S.has(key)) return true;
  const ending = ENDINGS.find(([spelling]) => spelling.test(key));
  return !ending || ending[1].test(ipa);
}

/** The entry each lowercase key uses: lowercase first, then capitalized, then all caps. */
const chosen = new Map();
for (const entry of entries) {
  const kind = caseClass(entry.word);
  if (kind === undefined) continue;
  if (kind > 0 && rankOf(entry) === UNRANKED) continue;
  const key = entry.word.toLowerCase();
  const ipa = toIpa(entry.phonetic, key);
  if (!ipa || !plausible(key, ipa)) continue;
  const previous = chosen.get(key);
  if (!previous || kind < previous.kind) chosen.set(key, { kind, ipa });
}

const table = new Map([...chosen].map(([key, { ipa }]) => [key, ipa]));
for (const word of EXTRA_WORDS) {
  if (!chosen.has(word)) console.warn(`No usable ECDICT phonetic for extra word "${word}"`);
}
for (const [word, raw] of Object.entries(MANUAL)) table.set(word, toIpa(raw, word));

/** en_US lines: `word\t/ipa/, /ipa/…`. */
const usTable = new Map();
for (const line of (await readFile(usInput, 'utf8')).split('\n')) {
  const tab = line.indexOf('\t');
  if (tab <= 0) continue;
  const word = line.slice(0, tab).toLowerCase();
  if (!/^[a-z]+$/.test(word) && !APOSTROPHE_WORDS.has(word)) continue;
  const ipa = toUsIpa(MANUAL_US.get(word) ?? line.slice(tab + 1));
  if (ipa) usTable.set(word, ipa);
}

const byWord = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
const shardText = (lines) => lines.map(([word, ipa]) => `${word}\t${ipa}\n`).join('');

/** Groups by two letters, then splits each group that is too large by three. */
function shardsOf(entries) {
  const groups = new Map();
  for (const entry of [...entries].sort(byWord)) {
    const key = shardKey(entry[0], 2);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const shards = new Map();
  for (const [key, lines] of groups) {
    if (gzipSync(shardText(lines)).length <= SHARD_LIMIT) {
      shards.set(key, lines);
      continue;
    }
    for (const entry of lines) {
      const sub = shardKey(entry[0], 3);
      if (!shards.has(sub)) shards.set(sub, []);
      shards.get(sub).push(entry);
    }
  }
  return new Map([...shards].sort(byWord));
}

const dict = resolve(root, 'public/dict');
await rm(resolve(dict, 'en-gb-phonetic.tsv'), { force: true });
await rm(resolve(dict, 'en-us-phonetic.tsv'), { force: true });
const lists = {};
for (const [accent, dir, entries] of [
  ['uk', 'gb', table],
  ['us', 'us', usTable],
]) {
  const target = resolve(dict, dir);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const shards = shardsOf(entries);
  let raw = 0;
  let packed = 0;
  let largest = 0;
  for (const [key, lines] of shards) {
    const text = shardText(lines);
    const size = gzipSync(text).length;
    raw += Buffer.byteLength(text);
    packed += size;
    largest = Math.max(largest, size);
    if (size > SHARD_LIMIT) console.warn(`${dir}/${key}.tsv is ${size} bytes gzipped`);
    await writeFile(resolve(target, `${key}.tsv`), text);
  }
  lists[accent] = [...shards.keys()].join(' ');
  console.log(
    `${dir}: ${entries.size} words in ${shards.size} shards, ${raw} bytes (${packed} gzipped, largest shard ${largest})`,
  );
}

await writeFile(
  resolve(dict, 'SOURCES.txt'),
  `# phonetic tables · build-phonetics ${VERSION}
gb/<shard>.tsv  British IPA. ECDICT, https://github.com/skywind3000/ECDICT
                commit ${COMMIT}, MIT (ECDICT-LICENSE.txt)
us/<shard>.tsv  American IPA. ipa-dict en_US, https://github.com/open-dict-data/ipa-dict
                commit ${US_COMMIT}, MIT (ipa-dict-LICENSE.txt),
                from lingz/cmudict-ipa (cmudict-ipa-LICENSE.txt) on the CMU Pronouncing
                Dictionary (CMUdict-LICENSE.txt)
Each shard holds the words whose first two letters (three for a split shard) name it, one
"word<TAB>ipa" line each, sorted. Generated by:
  node scripts/build-phonetics.mjs <ecdict.csv> <en_US.txt>
`,
);

await writeFile(
  resolve(root, 'src/lib/phonetic/shards.generated.ts'),
  `// Generated by scripts/build-phonetics.mjs (build-phonetics ${VERSION}); do not edit.
// The shards in public/dict/gb and public/dict/us, space-separated.

export const SHARDS = {
  uk: '${lists.uk}',
  us: '${lists.us}',
};
`,
);
