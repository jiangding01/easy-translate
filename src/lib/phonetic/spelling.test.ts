import { describe, expect, it } from 'vitest';
import { americanSpellings } from './spelling';

describe('americanSpellings', () => {
  it.each([
    ['internationalisation', 'internationalization'],
    ['organised', 'organized'],
    ['realising', 'realizing'],
    ['analyse', 'analyze'],
    ['paralysed', 'paralyzed'],
    ['colour', 'color'],
    ['behaviours', 'behaviors'],
    ['favourite', 'favorite'],
    ['honourable', 'honorable'],
    ['centre', 'center'],
    ['metres', 'meters'],
    ['catalogue', 'catalog'],
    ['dialogues', 'dialogs'],
    ['travelled', 'traveled'],
    ['cancelling', 'canceling'],
    ['defence', 'defense'],
    ['licences', 'licenses'],
  ])('%s → %s', (word, american) => {
    expect(americanSpellings(word)).toContain(american);
  });

  it.each(['color', 'center', 'analyze', 'map', 'service'])(
    'has nothing to offer for %s',
    (word) => {
      expect(americanSpellings(word)).toEqual([]);
    },
  );

  it('never returns the word itself or a duplicate', () => {
    const variants = americanSpellings('organisation');
    expect(variants).not.toContain('organisation');
    expect(new Set(variants).size).toBe(variants.length);
  });
});
