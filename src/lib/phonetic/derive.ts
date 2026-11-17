// Readings of regular inflections, derived from the headword's (both accents): the -s / -ed
// endings follow the headword's last sound, -ing adds ɪŋ. American readings use ɪz and ɪd
// as the British ones do: most en_US entries write them so (-ed 591 ɪd to 176 əd, -es
// 436 ɪz to 167 əz). Pure, no imports.

/** How the word differs from its headword (see `lemmaCandidates`). */
export type InflectionSuffix = 's' | 'ies' | 'ied' | 'ed' | 'ing';

const SIBILANT = /[szʃʒ]$/;
const VOICELESS = /[ptkfθ]$/;
/** Sounds a reading may end in: consonants, vowels, the length mark. */
const FINAL = /[bdfhjklmnprstvwzðŋθʃʒɡaeiouæɑɒɔəʌɜɪʊː]$/;
/** A final ɪ that ends a diphthong (eɪ aɪ ɔɪ) stays ɪ. */
const HAPPY = /([^eaɔ])ɪ$/;

/**
 * The inflected form's reading from the headword's; undefined when the headword's reading
 * does not end in a sound the rules know (or -ies / -ied after anything but a vowel).
 * British linking r: a final (r) is dropped before a consonant and sounded before ɪŋ, and so
 * is the silent r of a headword spelt -r / -re (`lemma`) that ends in a vowel (entering
 * ˈentərɪŋ).
 */
export function deriveForm(
  lemmaIpa: string,
  suffix: InflectionSuffix,
  lemma = '',
): string | undefined {
  const linkingR =
    lemmaIpa.endsWith('(r)') || (/re?$/.test(lemma) && /[aeiouæɑɒɔəʌɜɪʊː]$/.test(lemmaIpa));
  const base = lemmaIpa.endsWith('(r)') ? lemmaIpa.slice(0, -3) : lemmaIpa;
  if (!FINAL.test(base)) return undefined;
  // A one-syllable headword is written without a stress mark; a syllable added (ɪz, ɪd,
  // ɪŋ) makes two, and the stress stays on the first.
  const stressed = /[ˈˌ]/.test(base) ? base : `ˈ${base}`;
  if (suffix === 'ing') return `${stressed}${linkingR ? 'r' : ''}ɪŋ`;
  if (suffix === 'ies' || suffix === 'ied') {
    if (!/[iɪ]ː?$/.test(base)) return undefined;
    return `${base.replace(HAPPY, '$1i')}${suffix === 'ies' ? 'z' : 'd'}`;
  }
  if (suffix === 's') {
    return SIBILANT.test(base) ? `${stressed}ɪz` : `${base}${VOICELESS.test(base) ? 's' : 'z'}`;
  }
  return /[td]$/.test(base) ? `${stressed}ɪd` : `${base}${/[pkfθsʃ]$/.test(base) ? 't' : 'd'}`;
}
