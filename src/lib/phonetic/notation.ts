// ECDICT phonetic → modern British IPA (Gimson style, as in current Oxford / Cambridge
// learner's dictionaries). Pure functions with no imports: scripts/build-phonetics.mjs runs
// this file directly under Node, so it must stay erasable TypeScript (no enums, no
// namespaces, no parameter properties).
//
// ECDICT mixes two notations. Most entries use the older one (i / u for the short vowels,
// `:` for length, `'` and `,` or `.` for stress, Cyrillic `ә` for schwa, `^` for g, `\` for
// ɜ, sometimes `j` for ʊ); some use modern IPA. Both are first folded into the older ASCII
// form, then converted in one left-to-right pass, diphthongs before single vowels.

/** Alternative readings: `;`, and `.` or `,` followed by a space. */
const ALTERNATIVES = /;|[.,]\s/;
/** `,'` `.-` …: a stress mark cannot precede a primary stress or a hyphen, so it separates readings. */
const INNER_ALTERNATIVE = /[.,](?=['ˈ-])/;
/** Brackets, `?`, `@`, `=`, CJK and full-width forms: annotations, never a usable reading. */
const REJECT = /[[\]?@=⺀-鿿＀-￯]/;
/** Vowel symbols in the folded notation (a `j` before anything else stands for ʊ). */
const VOWEL = 'aeiouæɑɒɔəʌɜɛ';
/** Every character the folded notation may contain. */
const FOLDED = /^[abdefhijklmnoprstuvwzæðŋθʃʒʌɒɔɑɜəɛɡ:',()]+$/;
const HAS_VOWEL = /[aeiouæɑɒɔəʌɜɛ]/;

/** Single characters folded into the older ASCII-style notation. */
const FOLD: Record<string, string> = {
  ә: 'ə',
  ˊ: "'",
  ˈ: "'",
  ˌ: ',',
  '.': ',',
  ː: ':',
  ɪ: 'i',
  ʊ: 'u',
  ɵ: 'θ',
  '^': 'ɡ',
  g: 'ɡ',
  є: 'ɛ',
  ε: 'ɛ',
  ɚ: 'ə',
  c: 'k',
};

/** Two-character units first (diphthongs, long vowels), then single characters. */
const PAIRS: Record<string, string> = {
  ei: 'eɪ',
  ai: 'aɪ',
  ɑi: 'aɪ',
  ɔi: 'ɔɪ',
  ɒi: 'ɔɪ',
  au: 'aʊ',
  ɑu: 'aʊ',
  əu: 'əʊ',
  ou: 'əʊ',
  oə: 'əʊ',
  iə: 'ɪə',
  ɛə: 'eə',
  eə: 'eə',
  uə: 'ʊə',
  'i:': 'iː',
  'u:': 'uː',
  'ɑ:': 'ɑː',
  'a:': 'ɑː',
  'ɔ:': 'ɔː',
  'ɒ:': 'ɔː',
  'ə:': 'ɜː',
  'ɜ:': 'ɜː',
};
const SINGLES: Record<string, string> = {
  i: 'ɪ',
  u: 'ʊ',
  o: 'əʊ',
  a: 'æ',
  ɔ: 'ɒ',
  ɛ: 'e',
  ':': 'ː',
  "'": 'ˈ',
  ',': 'ˌ',
};

/**
 * The first reading of an ECDICT phonetic, folded into the older notation; undefined
 * when there is none or it carries annotations or symbols this module does not know.
 */
export function foldReading(raw: string): string | undefined {
  let reading = raw.replace(/ /g, ' ').trim();
  reading = (reading.split(ALTERNATIVES)[0] ?? '').split(INNER_ALTERNATIVE)[0] ?? '';
  if (REJECT.test(reading)) return undefined;
  let folded = '';
  for (const char of reading.replace(/\s+/g, '')) folded += FOLD[char] ?? char;
  folded = folded
    // `\` (sometimes doubled) is ɜ; `ɝ` is the American ɜr.
    .replace(/\\+/g, 'ɜ')
    .replace(/ɝ/g, 'ɜ:')
    // `oʊ` (American) has become `ou` above; `y` is j before a vowel, i elsewhere.
    .replace(/y(?=[aeiouæɑɒɔəʌɜɛ])/g, 'j')
    .replace(/y/g, 'i')
    // Optional length: kept on i and u (ju(:) → juː), dropped elsewhere.
    .replace(/([iu])\(:\)/g, '$1:')
    .replace(/\(:\)/g, '');
  // A `j` that is not followed by a vowel stands for ʊ (`'dajtidli`, `'mjzlim`).
  let out = '';
  for (let index = 0; index < folded.length; index += 1) {
    const char = folded[index] as string;
    const next = folded[index + 1];
    out += char === 'j' && !(next !== undefined && VOWEL.includes(next)) ? 'u' : char;
  }
  // A run of stress marks (`ˈˈ`, `ˌˈ`) is one mark, the strongest; a trailing one carries
  // nothing. A hyphen (a partial reading) fails the check below.
  out = out.replace(/[',]{2,}/g, (run) => (run.includes("'") ? "'" : ','));
  // A stress mark after the first consonants (`b'lækbə:dz`, `t'raiæŋglz`) belongs before them.
  out = out.replace(/^([^aeiouæɑɒɔəʌɜɛ',()]+)([',])/, '$2$1');
  out = firstOfInner(out.replace(/,+$/, ''));
  // Optional sounds are single symbols, `(ə)` `(r)`; anything else in brackets is a note.
  if (/[()]/.test(out.replace(/\([^()]\)/g, ''))) return undefined;
  if (!FOLDED.test(out) || !HAS_VOWEL.test(out)) return undefined;
  return onePrimary(out);
}

const bare = (reading: string) => reading.replace(/[',()]/g, '');

/**
 * Readings joined by a bare comma (`ə'bju:s,ə'bju:z`, `bæθ,bɑ:θ`): the part after the comma
 * starts like the whole reading and has a primary stress exactly when the part before has
 * one. A secondary stress inside a word (`'teli,viʒən`, `,ʌndə'stænd`) fails one of the two.
 */
function firstOfInner(reading: string): string {
  for (let index = reading.indexOf(',', 1); index > 0; index = reading.indexOf(',', index + 1)) {
    const before = reading.slice(0, index);
    const after = reading.slice(index + 1);
    if (
      HAS_VOWEL.test(before) &&
      bare(after)[0] === bare(reading)[0] &&
      before.includes("'") === after.includes("'")
    ) {
      return before;
    }
  }
  return reading;
}

/** ECDICT marks some compounds with two primary stresses (`'ɑ:ftə'nu:n`): all but the last become secondary. */
function onePrimary(reading: string): string {
  const last = reading.lastIndexOf("'");
  if (last <= 0) return reading;
  return `${reading.slice(0, last).replace(/'/g, ',')}${reading.slice(last)}`;
}

/** Converts a folded reading (see `foldReading`) to modern British IPA. */
export function convertFolded(folded: string): string {
  let ipa = '';
  let index = 0;
  while (index < folded.length) {
    const pair = PAIRS[folded.slice(index, index + 2)];
    if (pair !== undefined) {
      ipa += pair;
      index += 2;
      continue;
    }
    const char = folded[index] as string;
    ipa += SINGLES[char] ?? char;
    index += 1;
  }
  return ipa;
}

/** Vowel symbols in converted IPA. */
const IPA_VOWEL = /[aeiouæɑɒɔəʌɜɪʊ]/;

/**
 * The happY vowel: an unstressed short i at the end of a word is written i (lady ˈleɪdi),
 * and so is the one before the -z / -d of a word spelt -ies / -ied (rallied ˈrælid). Not
 * after e, a or ɔ (that ɪ ends a diphthong), and not in the stressed syllable: one with
 * no vowel between the last stress mark (or the start, without one) and this ɪ.
 */
function happyVowel(ipa: string, word: string | undefined): string {
  const ending = /ɪ$/.test(ipa)
    ? ''
    : word && /ie[sd]$/.test(word) && /ɪ[zd]$/.test(ipa)
      ? ipa.slice(-1)
      : undefined;
  if (ending === undefined) return ipa;
  const at = ipa.length - ending.length - 1;
  const before = ipa[at - 1] ?? '';
  const syllable = ipa.slice(Math.max(ipa.lastIndexOf('ˈ'), ipa.lastIndexOf('ˌ')) + 1, at);
  if ('eaɔ'.includes(before) || !IPA_VOWEL.test(syllable)) return ipa;
  return `${ipa.slice(0, at)}i${ending}`;
}

/**
 * ECDICT phonetic → modern British IPA; undefined when the entry is unusable. `word` (the
 * lowercase spelling) lets the -ies / -ied rule of the happY vowel apply.
 */
export function toIpa(raw: string, word?: string): string | undefined {
  const folded = foldReading(raw);
  if (folded === undefined) return undefined;
  // hw (the old wh) is plain w in modern British English, anywhere in the word
  // (whistle ˈwɪsl, nowhere ˈnəʊweə).
  const ipa = convertFolded(folded).replace(/hw/g, 'w');
  return happyVowel(ipa, word);
}

// ---------------------------------------------------------------- American (ipa-dict en_US)

// ipa-dict's en_US (CMUdict through cmudict-ipa, stress added by syllabify) is written in
// narrow American IPA: ɹ, dark ɫ, ɛ, ə for both schwa and the stressed STRUT vowel, ɝ for
// both stressed and unstressed r-coloured vowels, no length marks, and a stress mark on
// every monosyllable. It is respelled the way Chinese learners know American IPA from the
// Oxford learner's dictionaries: r, l, e, ʌ when stressed, ɜːr stressed and ər unstressed,
// iː uː stressed, ɑː ɔː always, and no stress mark on a word of one syllable.

/** Nuclei, longest first: the diphthongs, then single vowels. */
const US_NUCLEUS = /aɪ|aʊ|eɪ|oʊ|ɔɪ|[iuɑɔəɝɚɪʊeæ]/y;
const US_RESPELL: Record<string, string> = { ɹ: 'r', ɫ: 'l', ɛ: 'e', g: 'ɡ' };
/** Every character a respelled American reading may contain. */
const US_OUT = /^[ˈˌabdefhijklmnoprstuvwzæðŋθʃʒʌɑɒɔəɜɪʊɡː]+$/;

/** Stressed and unstressed spellings of each single-vowel nucleus that changes. */
const US_VOWEL: Record<string, [stressed: string, unstressed: string]> = {
  ə: ['ʌ', 'ə'],
  ɝ: ['ɜːr', 'ər'],
  ɚ: ['ɜːr', 'ər'],
  i: ['iː', 'i'],
  u: ['uː', 'u'],
  ɑ: ['ɑː', 'ɑː'],
  ɔ: ['ɔː', 'ɔː'],
};

/**
 * Sounds in a reading: its characters without slashes, spaces and stress marks, an
 * affricate (tʃ dʒ) or a diphthong counting as one (so ˈmɛntʃɹi is not longer than ˈmɛntɝi).
 */
const soundCount = (reading: string) =>
  reading.replace(/[/\sˈˌ]/g, '').replace(/tʃ|dʒ|aɪ|aʊ|eɪ|oʊ|ɔɪ/g, '.').length;

/**
 * ipa-dict en_US entry (`/ˈkaʊnəd/, /ˈkaʊnɪd/, /ˈkaʊntɪd/`) → learner's American IPA;
 * undefined when there is none or it holds symbols this module does not know. The reading
 * with the most sounds is taken (the first of those): the first one is often a casual,
 * reduced form (ˈkaʊnəd for counted, ˈkɑntɹæs for contrasts).
 */
export function toUsIpa(raw: string): string | undefined {
  let first = '';
  for (const candidate of raw.split(',')) {
    if (soundCount(candidate) > soundCount(first)) first = candidate;
  }
  first = first.trim().replace(/^\/|\/$/g, '');
  let reading = '';
  for (const char of first) reading += US_RESPELL[char] ?? char;
  // A final unstressed-looking ˌi (ability əˈbɪɫəˌti) is the happY vowel, not a stress.
  // syllabify splits C+j onsets (əkˈjumjəˌɫeɪt) and hw (ˌoʊvɝhˈwɛɫm): the stress goes
  // before the consonant.
  reading = reading.replace(/([^ˈˌaeiouæɑɔəɛɝɪʊ])([ˈˌ])j/g, '$2$1j').replace(/h([ˈˌ])w/g, '$1hw');
  // Only a ˌ whose syllable is that i: consonants between them, no other vowel.
  reading = reading.replace(/ˌ([^ˈˌaeiouæɑɔəɛɝɪʊ]*)i$/, '$1i');
  // One primary stress: the last; with none, the last secondary becomes primary.
  const primary = reading.lastIndexOf('ˈ');
  if (primary > 0)
    reading = `${reading.slice(0, primary).replace(/ˈ/g, 'ˌ')}${reading.slice(primary)}`;
  else if (primary < 0) {
    const secondary = reading.lastIndexOf('ˌ');
    if (secondary >= 0) reading = `${reading.slice(0, secondary)}ˈ${reading.slice(secondary + 1)}`;
  }
  const nuclei: { at: number; text: string; stressed: boolean }[] = [];
  let stressNext = false;
  for (let index = 0; index < reading.length; ) {
    const char = reading[index] as string;
    if (char === 'ˈ' || char === 'ˌ') {
      stressNext = true;
      index += 1;
      continue;
    }
    US_NUCLEUS.lastIndex = index;
    const match = US_NUCLEUS.exec(reading);
    if (match) {
      nuclei.push({ at: index, text: match[0], stressed: stressNext });
      stressNext = false;
      index += match[0].length;
    } else index += 1;
  }
  if (nuclei.length === 0) return undefined;
  // One syllable: stressed, and written without a mark (as in the British table).
  if (nuclei.length === 1) {
    const only = nuclei[0] as (typeof nuclei)[number];
    only.stressed = true;
  }
  let out = '';
  let from = 0;
  for (const nucleus of nuclei) {
    out += reading.slice(from, nucleus.at);
    const spellings = US_VOWEL[nucleus.text];
    out += spellings ? spellings[nucleus.stressed ? 0 : 1] : nucleus.text;
    from = nucleus.at + nucleus.text.length;
  }
  out += reading.slice(from);
  if (nuclei.length === 1) out = out.replace(/[ˈˌ]/g, '');
  // hw is w anywhere, as in the British table (overwhelm ˌoʊvərˈwelm).
  out = out.replace(/hw/g, 'w');
  return US_OUT.test(out) ? out : undefined;
}
