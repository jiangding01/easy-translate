import { describe, expect, it } from 'vitest';
import { convertFolded, foldReading, toIpa, toUsIpa } from './notation';

// Raw phonetics as they appear in ECDICT (commit 39cfb96), with the expected British IPA.
const SAMPLES: [word: string, raw: string, ipa: string][] = [
  // The plan's own samples. `different` is ECDICT's three-syllable reading.
  ['different', "'difәrәnt", 'ˈdɪfərənt'],
  ['reputed', "ri'pju:tid", 'rɪˈpjuːtɪd'],
  ['concert', "'kɒnsәt", 'ˈkɒnsət'],
  ['withdrawal', "wið'drɒ:l", 'wɪðˈdrɔːl'],
  ['abdication', ".æbdi'keiʃәn", 'ˌæbdɪˈkeɪʃən'],
  ['wield', 'wi:ld', 'wiːld'],
  ['ostrich', "'ɒstritʃ", 'ˈɒstrɪtʃ'],
  ['periscope', "'periskәup", 'ˈperɪskəʊp'],
  // Diphthongs.
  ['hello', "hә'lәu", 'həˈləʊ'],
  ['change', 'tʃeindʒ', 'tʃeɪndʒ'],
  ['fire', "'faiә", 'ˈfaɪə'],
  ['our', "'auә", 'ˈaʊə'],
  ['boy', 'bɒi', 'bɔɪ'],
  ['near', 'niә', 'nɪə'],
  ['hair', 'hєә', 'heə'],
  ['shared', 'ʃεәd', 'ʃeəd'],
  ['tour', 'tuә', 'tʊə'],
  ['go', 'gou', 'ɡəʊ'],
  ['player', "'pleiә", 'ˈpleɪə'],
  ['flying', "'flaiiŋ", 'ˈflaɪɪŋ'],
  // Long vowels.
  ['are', 'ɑ:', 'ɑː'],
  ['thought', 'θɒ:t', 'θɔːt'],
  ['bird', 'bә:d', 'bɜːd'],
  ['food', 'fu:d', 'fuːd'],
  ['sharpe', "'ʃa:p", 'ˈʃɑːp'],
  // ECDICT's odd symbols: ^ for g, \ for ɜ, j for ʊ, ˊ for ', y for j, lone ɔ for ɒ.
  ['english', "'iŋgliʃ", 'ˈɪŋɡlɪʃ'],
  ['god', '^ɔd', 'ɡɒd'],
  ['permanently', "'p\\\\:mәntli", 'ˈpɜːməntli'],
  ['undoubtedly', "ʌn'dajtidli", 'ʌnˈdaʊtɪdli'],
  ['mobilise', "'mәjbilɑiz", 'ˈməʊbɪlaɪz'],
  ['muslim', "'mjzlim; (?@) 'mʌzlem", 'ˈmʊzlɪm'],
  ['whitespace', 'ˊhwaitspeis', 'ˈwaɪtspeɪs'],
  ['yearling', "'yiәliŋ", 'ˈjɪəlɪŋ'],
  ['john', 'dʒɔn', 'dʒɒn'],
  ['roadmap', "'rod,mæp", 'ˈrəʊdˌmæp'],
  // Entries already in modern IPA come out the same.
  ['privatisation', "ˌpraɪvətaɪ'zeɪʃən", 'ˌpraɪvətaɪˈzeɪʃən'],
  ['firefighter', 'ˈfaɪəfaɪtə(r)', 'ˈfaɪəfaɪtə(r)'],
  ['empowerment', "ɪm'paʊəmənt", 'ɪmˈpaʊəmənt'],
  // Secondary stress inside the word, optional sounds, optional length.
  ['television', "'teli.viʒәn", 'ˈtelɪˌvɪʒən'],
  ['understand', ".ʌndә'stænd", 'ˌʌndəˈstænd'],
  ['mr', "'mistә(r)", 'ˈmɪstə(r)'],
  ['frightened', "'frait(ә)nd", 'ˈfraɪt(ə)nd'],
  ['ukraine', "ju(:)'krein", 'juːˈkreɪn'],
  // Only the first reading.
  ['poor', 'puә. pɒ:', 'pʊə'],
  ['ma’am', 'mæm, mɑ:m, mәm', 'mæm'],
  ['realise', "'riәlaiz,'ri:-", 'ˈrɪəlaɪz'],
  ['longer', "'lɔŋɡә. 'lɔ:ŋ-", 'ˈlɒŋɡə'],
  ['abuse', "ə'bju:s,ə'bju:z", 'əˈbjuːs'],
  ['bath', 'bæθ,bɑ:θ', 'bæθ'],
  // Two primary stresses: the first becomes secondary.
  ['afternoon', "'ɑ:ftә'nu:n", 'ˌɑːftəˈnuːn'],
  ['rehabilitation', "'ri:(h)ә,bili'teiʃәn", 'ˌriː(h)əˌbɪlɪˈteɪʃən'],
  // A stress mark misplaced after the first consonant moves before it.
  ['triangles', "t'raɪæŋɡlz", 'ˈtraɪæŋɡlz'],
  ['blackbirds', "b'lækbә:dz", 'ˈblækbɜːdz'],
  // A doubled stress mark is one.
  ['solicitations', 'səˌlɪsɪˈˈteɪʃənz', 'səˌlɪsɪˈteɪʃənz'],
];

describe('toIpa', () => {
  it.each(SAMPLES)('%s: %s → %s', (_word, raw, ipa) => {
    expect(toIpa(raw)).toBe(ipa);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ["[gi'lespi]", 'square brackets'],
    ['kɔx', 'an unknown symbol'],
    ["'ræbdәj,maiә?sɑ:'kәjmә", 'a question mark'],
    ['意大利语', 'Chinese'],
    ['mæm；mɑ:m', 'full-width punctuation'],
    ["'lɔ:ŋ-", 'a partial reading'],
    ['ˈædɪkt(fəʊrnˌ)', 'a note in brackets'],
    ["'", 'no vowel'],
  ])('rejects %s (%s)', (raw) => {
    expect(toIpa(raw)).toBeUndefined();
  });
});

describe('happY vowel: an unstressed final short i is i', () => {
  it.each([
    ['lady', "'leidi", 'ˈleɪdi'],
    ['aptly', "'æptli", 'ˈæptli'],
    ['secrecy', "'si:krisi", 'ˈsiːkrɪsi'],
    ['blasphemy', "'blæsfәmi", 'ˈblæsfəmi'],
    ['jenny', "'dʒeni", 'ˈdʒeni'],
    ['ability', "ә'biliti", 'əˈbɪlɪti'],
    ['bikini', "bi'ki:ni", 'bɪˈkiːni'],
    // -ies / -ied spellings: the ɪ before the final z / d too.
    ['rallied', 'ˈrælid', 'ˈrælid'],
    ['married', "'mærid", 'ˈmærid'],
    ['armies', 'ˈɑ:miz', 'ˈɑːmiz'],
    ['accompanies', 'əˈkʌmpəniz', 'əˈkʌmpəniz'],
    ['anxieties', 'æŋˈzaiətiz', 'æŋˈzaɪətiz'],
  ])('%s: %s → %s', (word, raw, ipa) => {
    expect(toIpa(raw, word)).toBe(ipa);
  });

  it.each([
    // ɪ inside the word, or no ɪ at the end.
    ['countryside', "'kʌntrisaid", 'ˈkʌntrɪsaɪd'],
    ['ritz', 'rits', 'rɪts'],
    ['mishap', "'mishæp", 'ˈmɪshæp'],
    ['wanted', "'wɔntid. 'wɔ:n-", 'ˈwɒntɪd'],
    ['watches', "'wɒtʃiz", 'ˈwɒtʃɪz'],
    // Long already, or the stressed (only) syllable.
    ['he', 'hi:', 'hiː'],
    ['dignitaries', 'ˈdɪgnɪˌteri:z', 'ˈdɪɡnɪˌteriːz'],
    ['sri', 'sri', 'srɪ'],
    // The end of a diphthong.
    ['day', 'dei', 'deɪ'],
    ['boy', 'bɒi', 'bɔɪ'],
  ])('leaves %s alone: %s → %s', (word, raw, ipa) => {
    expect(toIpa(raw, word)).toBe(ipa);
  });

  it('applies the -ies / -ied rule only when it knows the spelling', () => {
    expect(toIpa('ˈrælid')).toBe('ˈrælɪd');
  });
});

describe('hw is w', () => {
  it.each([
    ['whistles', 'ˈhwislz', 'ˈwɪslz'],
    ['whitespace', 'ˊhwaitspeis', 'ˈwaɪtspeɪs'],
    ['what', 'hwɒt', 'wɒt'],
    ['whatsoever', ".hwɒtsәu'evә", 'ˌwɒtsəʊˈevə'],
    ['whisky', "'hwiski", 'ˈwɪski'],
  ])('%s: %s → %s', (word, raw, ipa) => {
    expect(toIpa(raw, word)).toBe(ipa);
  });

  it.each([
    ['somewhat', "'sʌmhwɒt", 'ˈsʌmwɒt'],
    ['nowhere', "'nәuhwєә", 'ˈnəʊweə'],
    ['anywhere', "'enihwєә", 'ˈenɪweə'],
  ])('inside the word too, %s: %s → %s', (word, raw, ipa) => {
    expect(toIpa(raw, word)).toBe(ipa);
  });

  it.each([
    ['happy', "'hæpi", 'ˈhæpi'],
    ['household', "'haushәuld", 'ˈhaʊshəʊld'],
  ])('leaves a plain h alone in %s: %s → %s', (word, raw, ipa) => {
    expect(toIpa(raw, word)).toBe(ipa);
  });
});

describe('foldReading / convertFolded', () => {
  it('folds modern IPA into the older notation, which converts back unchanged', () => {
    expect(foldReading('ˈfaɪəfaɪtə(r)')).toBe("'faiəfaitə(r)");
    expect(convertFolded("'faiəfaitə(r)")).toBe('ˈfaɪəfaɪtə(r)');
  });

  it('keeps a j before a vowel', () => {
    expect(toIpa("'ju:ʒuәli")).toBe('ˈjuːʒʊəli');
  });
});

// ipa-dict en_US entries (commit 972cd67), with the expected learner's American IPA.
describe('toUsIpa', () => {
  it.each([
    // The reading with the most sounds, the first of those on a tie.
    ['counted', '/ˈkaʊnəd/, /ˈkaʊnɪd/, /ˈkaʊntɪd/', 'ˈkaʊntɪd'],
    ['contrasts', '/ˈkɑntɹæs/, /ˈkɑntɹæsts/, /kənˈtɹæs/, /kənˈtɹæsts/', 'ˈkɑːntræsts'],
    [
      'supplementary',
      '/ˌsəpɫəˈmɛnɝi/, /ˌsəpɫəˈmɛntɝi/, /ˌsəpɫəˈmɛntɹi/, /ˌsəpɫəˈmɛntʃɹi/',
      'ˌsʌpləˈmentəri',
    ],
    ['with (tie)', '/ˈwɪð/, /ˈwɪθ/, /wɪð/, /wɪθ/', 'wɪð'],
    // A diphthong is one sound: a tie, so the first.
    ['abdomen', '/ˈæbdəmən/, /æbˈdoʊmən/', 'ˈæbdəmən'],
    ['hundred', '/ˈhəndɝd/, /ˈhəndɹəd/, /ˈhənɝd/', 'ˈhʌndrəd'],
    ['overwhelm', '/ˌoʊvɝˈwɛɫm/, /ˌoʊvɝhˈwɛɫm/', 'ˌoʊvərˈwelm'],
    ['are', '/ˈɑɹ/, /ɝ/', 'ɑːr'],
    // ɹ → r, ɫ → l, ɛ → e.
    ['hello', '/həˈɫoʊ/, /hɛˈɫoʊ/', 'həˈloʊ'],
    ['american', '/əˈmɛɹəkən/, /əˈmɛɹɪkən/', 'əˈmerəkən'],
    ['different', '/ˈdɪfɝənt/, /ˈdɪfɹənt/', 'ˈdɪfərənt'],
    // Stressed ə is ʌ.
    ['study', '/ˈstədi/', 'ˈstʌdi'],
    ['above', '/əˈbəv/', 'əˈbʌv'],
    ['run', '/ˈɹən/', 'rʌn'],
    // ɝ: ɜːr stressed, ər unstressed.
    ['bird', '/ˈbɝd/', 'bɜːrd'],
    ['better', '/ˈbɛtɝ/', 'ˈbetər'],
    ['person', '/ˈpɝsən/', 'ˈpɜːrsən'],
    ['university', '/ˌjunəˈvɝsəti/', 'ˌjuːnəˈvɜːrsəti'],
    // Long vowels: i u when stressed, ɑ ɔ always; unstressed i stays short.
    ['teacher', '/ˈtitʃɝ/', 'ˈtiːtʃər'],
    ['cute', '/ˈkjut/', 'kjuːt'],
    ['car', '/ˈkɑɹ/', 'kɑːr'],
    ['water', '/ˈwɔtɝ/', 'ˈwɔːtər'],
    ['city', '/ˈsɪti/', 'ˈsɪti'],
    ['situation', '/ˌsɪtʃuˈeɪʃən/', 'ˌsɪtʃuˈeɪʃən'],
    // Diphthongs stay; r after them.
    ['go', '/ˈɡoʊ/', 'ɡoʊ'],
    ['hair', '/ˈhɛɹ/', 'her'],
    ['near', '/ˈnɪɹ/', 'nɪr'],
    ['fire', '/ˈfaɪɝ/, /ˈfaɪɹ/', 'ˈfaɪər'],
    // Stress marks: none on one syllable, one primary, a final ˌ…i is the happY vowel.
    ['stopped', '/ˈstɑpt/', 'stɑːpt'],
    ['asynchronous', '/ˈeɪˈsɪŋkɹənəs/', 'ˌeɪˈsɪŋkrənəs'],
    ['accredit', '/əˌkɹɛdət/', 'əˈkredət'],
    ['ability', '/əˈbɪɫəˌti/', 'əˈbɪləti'],
    ['callback', '/ˈkɔɫˌbæk/', 'ˈkɔːlˌbæk'],
    // syllabify's C+j split: the stress goes before the consonant.
    ['accumulate', '/əkˈjumjəˌɫeɪt/', 'əˈkjuːmjəˌleɪt'],
    ['secures', '/sɪkˈjʊɹz/', 'sɪˈkjʊrz'],
    // Initial hw is w.
    ['whistled', '/ˈhwɪsəɫd/, /ˈwɪsəɫd/', 'ˈwɪsəld'],
    // A ˌ on an earlier syllable stays.
    ['blackberry', '/ˈbɫækˌbɛɹi/', 'ˈblækˌberi'],
    ["y'all", '/ˌjɔɫ/', 'jɔːl'],
  ])('%s: %s → %s', (_word, raw, ipa) => {
    expect(toUsIpa(raw)).toBe(ipa);
  });

  it.each(['', '/ /', '/ˈ/', '/kɑx/', '/tʃ/'])('rejects %j', (raw) => {
    expect(toUsIpa(raw)).toBeUndefined();
  });
});
