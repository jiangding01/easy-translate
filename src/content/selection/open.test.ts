import { describe, expect, it } from 'vitest';
import type { SelectionSnapshot } from '../runtime-contract';
import { decideOpen, normalizeSelectionText } from './open';

const top: SelectionSnapshot = {
  source: 'Hello world',
  rect: { left: 0, top: 0, right: 10, bottom: 10 },
  anchor: { x: 10, y: 0 },
};

describe('normalizeSelectionText', () => {
  it('collapses whitespace runs and trims', () => {
    expect(normalizeSelectionText('  a \n\t b  ')).toBe('a b');
  });
});

describe('decideOpen: shortcut (no selectionText)', () => {
  it('ignores it when the top document does not have focus', () => {
    expect(decideOpen({ hasFocus: false, top })).toEqual({ kind: 'ignore' });
    expect(decideOpen({ hasFocus: false })).toEqual({ kind: 'ignore' });
  });

  it('uses the top selection when focused', () => {
    expect(decideOpen({ hasFocus: true, top })).toEqual({ kind: 'top', selection: top });
  });

  it('closes the card when there is no selection', () => {
    expect(decideOpen({ hasFocus: true })).toEqual({ kind: 'close' });
  });
});

describe('decideOpen: context menu (selectionText)', () => {
  it('uses the text alone for a selection in an iframe, ignoring a stale top selection', () => {
    expect(
      decideOpen({ selectionText: ' Hello  world ', frameId: 7, hasFocus: true, top }),
    ).toEqual({ kind: 'detached', source: 'Hello world' });
  });

  it('does not require focus for the menu', () => {
    expect(decideOpen({ selectionText: 'Hello world', frameId: 0, hasFocus: false, top })).toEqual({
      kind: 'top',
      selection: top,
    });
  });

  it('uses the top selection when it matches the menu text after normalization', () => {
    expect(decideOpen({ selectionText: 'Hello\n world', frameId: 0, hasFocus: true, top })).toEqual(
      { kind: 'top', selection: top },
    );
  });

  it('falls back to the menu text when the top selection disagrees', () => {
    expect(
      decideOpen({ selectionText: 'Something else', frameId: 0, hasFocus: true, top }),
    ).toEqual({ kind: 'detached', source: 'Something else' });
  });

  it('falls back to the menu text when the top frame has no readable selection', () => {
    expect(decideOpen({ selectionText: 'Shadow text', frameId: 0, hasFocus: true })).toEqual({
      kind: 'detached',
      source: 'Shadow text',
    });
  });

  it('treats a missing frameId as the top frame', () => {
    expect(decideOpen({ selectionText: 'Hello world', hasFocus: true, top })).toEqual({
      kind: 'top',
      selection: top,
    });
  });

  it('ignores a blank menu text', () => {
    expect(decideOpen({ selectionText: ' \n ', frameId: 0, hasFocus: true, top })).toEqual({
      kind: 'ignore',
    });
  });
});
