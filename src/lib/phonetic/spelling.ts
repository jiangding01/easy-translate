// British spellings have no entry in the American table (it comes from CMUdict, which
// spells the American way): `internationalisation`, `colour`, `centre`. The reading is the
// same, so a British word the American table misses is looked up again in its American
// spellings. A variant only counts when the table has it, so a rule that does not apply
// to some word (`promise` is never `promize`) costs a lookup, never a wrong reading.

const RULES: readonly [RegExp, string][] = [
  // -ise / -isation and their forms: organise, organised, organisation, realising.
  [/is(e|es|ed|ing|er|ers|ation|ations)$/, 'iz$1'],
  // -yse: analyse, analysed, paralysing.
  [/ys(e|es|ed|ing|er|ers)$/, 'yz$1'],
  // -our: colour, behaviours, favourite, honourable, labourer.
  [/our(s|ed|ing|ite|ites|able|ably|ful|less|er|ers|ism)?$/, 'or$1'],
  // -tre: centre, metres, theatre.
  [/tre(s)?$/, 'ter$1'],
  // -ogue: catalogue, dialogues.
  [/ogue(s)?$/, 'og$1'],
  // Doubled l before a suffix: travelled, cancelling, modeller.
  [/ll(ed|ing|er|ers)$/, 'l$1'],
  // -ence for nouns spelled -ense: defence, offences, licence.
  [/ence(s)?$/, 'ense$1'],
];

/** American spellings to try for a British `word` (lower case), most specific first. */
export function americanSpellings(word: string): string[] {
  const variants: string[] = [];
  for (const [pattern, replacement] of RULES) {
    if (!pattern.test(word)) continue;
    const variant = word.replace(pattern, replacement);
    if (variant !== word && !variants.includes(variant)) variants.push(variant);
  }
  return variants;
}
