import { describe, expect, it } from 'vitest';
import { deriveForm } from './derive';

describe('deriveForm', () => {
  it.each([
    // -s / -es: sibilants take ɪz, voiceless sounds s, everything else z.
    ['watch', 'wɒtʃ', 'ˈwɒtʃɪz'],
    ['change', 'tʃeɪndʒ', 'ˈtʃeɪndʒɪz'],
    ['bus', 'bʌs', 'ˈbʌsɪz'],
    ['rose', 'rəʊz', 'ˈrəʊzɪz'],
    ['wish', 'wɪʃ', 'ˈwɪʃɪz'],
    ['stop', 'stɒp', 'stɒps'],
    ['cat', 'kæt', 'kæts'],
    ['book', 'bʊk', 'bʊks'],
    ['laugh', 'lɑːf', 'lɑːfs'],
    ['month', 'mʌnθ', 'mʌnθs'],
    ['display', 'dɪˈspleɪ', 'dɪˈspleɪz'],
    ['dog', 'dɒɡ', 'dɒɡz'],
    ['car (US)', 'kɑːr', 'kɑːrz'],
    ['mister', 'ˈmɪstə(r)', 'ˈmɪstəz'],
  ])('-s: %s /%s/ → /%s/', (_word, lemma, form) => {
    expect(deriveForm(lemma, 's')).toBe(form);
  });

  it.each([
    // -ed: t and d take ɪd, voiceless sounds t, everything else d.
    ['support', 'səˈpɔːt', 'səˈpɔːtɪd'],
    ['add', 'æd', 'ˈædɪd'],
    ['stop', 'stɒp', 'stɒpt'],
    ['hope', 'həʊp', 'həʊpt'],
    ['look', 'lʊk', 'lʊkt'],
    ['wash', 'wɒʃ', 'wɒʃt'],
    ['watch', 'wɒtʃ', 'wɒtʃt'],
    ['miss', 'mɪs', 'mɪst'],
    ['change', 'tʃeɪndʒ', 'tʃeɪndʒd'],
    ['play', 'pleɪ', 'pleɪd'],
    ['order', 'ˈɔːdə(r)', 'ˈɔːdəd'],
  ])('-ed: %s /%s/ → /%s/', (_word, lemma, form) => {
    expect(deriveForm(lemma, 'ed')).toBe(form);
  });

  it.each([
    ['make', 'meɪk', 'ˈmeɪkɪŋ'],
    ['run', 'rʌn', 'ˈrʌnɪŋ'],
    ['study', 'ˈstʌdi', 'ˈstʌdiɪŋ'],
    ['order', 'ˈɔːdə(r)', 'ˈɔːdərɪŋ'],
    ['enter (US)', 'ˈentər', 'ˈentərɪŋ'],
  ])('-ing: %s /%s/ → /%s/', (_word, lemma, form) => {
    expect(deriveForm(lemma, 'ing')).toBe(form);
  });

  it.each([
    ['enter', 'ˈentə', 'ˈentərɪŋ'],
    ['care', 'keə', 'ˈkeərɪŋ'],
    ['occur', 'əˈkɜː', 'əˈkɜːrɪŋ'],
  ])('-ing sounds the silent r of a headword spelt -r / -re: %s', (word, lemma, form) => {
    expect(deriveForm(lemma, 'ing', word)).toBe(form);
    // Not before a consonant.
    expect(deriveForm(lemma, 's', word)).toBe(`${lemma}z`);
  });

  it.each([
    ['study', 'ˈstʌdi', 'ies', 'ˈstʌdiz'],
    ['rally', 'ˈrælɪ', 'ied', 'ˈrælid'],
    ['carry', 'ˈkæri', 'ied', 'ˈkærid'],
    ['apply', 'əˈplaɪ', 'ies', 'əˈplaɪz'],
    ['deny', 'dɪˈnaɪ', 'ied', 'dɪˈnaɪd'],
  ] as const)('-%s: %s /%s/ → /%s/', (_word, lemma, suffix, form) => {
    expect(deriveForm(lemma, suffix)).toBe(form);
  });

  it.each([
    ['', 's'],
    ['spaɪ(', 'ed'],
    ['ˈ', 'ing'],
    // -ies / -ied after a consonant: the headword is not a -y word after all.
    ['stʌd', 'ies'],
  ] as const)('gives up on /%s/ (%s)', (lemma, suffix) => {
    expect(deriveForm(lemma, suffix)).toBeUndefined();
  });
});
