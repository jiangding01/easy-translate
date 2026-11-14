import { describe, expect, it } from 'vitest';
import { listKey, placeList, typeahead } from './select-model';

describe('listKey', () => {
  it('moves within bounds, starting from the end on ArrowUp when nothing is active', () => {
    expect(listKey('ArrowDown', -1, 3)).toEqual({ type: 'move', index: 0 });
    expect(listKey('ArrowDown', 2, 3)).toEqual({ type: 'move', index: 2 });
    expect(listKey('ArrowUp', -1, 3)).toEqual({ type: 'move', index: 2 });
    expect(listKey('ArrowUp', 0, 3)).toEqual({ type: 'move', index: 0 });
    expect(listKey('Home', 2, 3)).toEqual({ type: 'move', index: 0 });
    expect(listKey('End', 0, 3)).toEqual({ type: 'move', index: 2 });
  });

  it('chooses with Enter or Space only when something is active', () => {
    expect(listKey('Enter', 1, 3)).toEqual({ type: 'choose', index: 1 });
    expect(listKey(' ', 0, 3)).toEqual({ type: 'choose', index: 0 });
    expect(listKey('Enter', -1, 3)).toEqual({ type: 'none' });
  });

  it('closes on Esc (focus back to the trigger) and Tab (focus moves on)', () => {
    expect(listKey('Escape', 1, 3)).toEqual({ type: 'close', restoreFocus: true });
    expect(listKey('Tab', 1, 3)).toEqual({ type: 'close', restoreFocus: false });
    expect(listKey('Escape', -1, 0)).toEqual({ type: 'close', restoreFocus: true });
    expect(listKey('ArrowDown', -1, 0)).toEqual({ type: 'none' });
  });
});

describe('typeahead', () => {
  const labels = ['English', '日本語', 'Español', 'Deutsch', 'easy'];

  it('finds the next label starting with the typed text, case-insensitively, wrapping', () => {
    expect(typeahead(labels, -1, 'e')).toBe(0);
    expect(typeahead(labels, 0, 'e')).toBe(2);
    expect(typeahead(labels, 4, 'e')).toBe(0);
    expect(typeahead(labels, -1, '日')).toBe(1);
  });

  it('keeps the current match while a word is being typed', () => {
    expect(typeahead(labels, 2, 'es')).toBe(2);
    expect(typeahead(labels, 0, 'ea')).toBe(4);
  });

  it('cycles on a repeated letter and reports no match', () => {
    expect(typeahead(labels, 0, 'ee')).toBe(2);
    expect(typeahead(labels, 0, 'x')).toBe(-1);
    expect(typeahead(labels, 0, '')).toBe(-1);
  });
});

describe('placeList', () => {
  const viewport = { width: 800, height: 600 };
  const at = (top: number, left = 100, width = 120) => ({
    top,
    bottom: top + 36,
    left,
    right: left + width,
    width,
  });

  it('opens below when the list fits there', () => {
    expect(
      placeList({ trigger: at(100), viewport, listHeight: 200, minWidth: 0, align: 'start' }),
    ).toEqual({
      side: 'below',
      offset: 142,
      left: 100,
      width: 120,
      maxHeight: 450,
    });
  });

  it('flips above near the bottom when there is more room there', () => {
    const placement = placeList({
      trigger: at(520),
      viewport,
      listHeight: 300,
      minWidth: 0,
      align: 'start',
    });
    expect(placement).toMatchObject({ side: 'above', offset: 86, maxHeight: 506 });
  });

  it('honors the minimum width, aligns to the end and stays inside the viewport', () => {
    expect(
      placeList({
        trigger: at(100, 700, 80),
        viewport,
        listHeight: 100,
        minWidth: 236,
        align: 'end',
      }),
    ).toMatchObject({ left: 544, width: 236 });
    expect(
      placeList({
        trigger: at(100, 760, 30),
        viewport,
        listHeight: 100,
        minWidth: 236,
        align: 'start',
      }),
    ).toMatchObject({ left: 556 });
    expect(
      placeList({
        trigger: at(100),
        viewport: { width: 200, height: 600 },
        listHeight: 100,
        minWidth: 400,
        align: 'start',
      }).width,
    ).toBe(184);
  });
});
