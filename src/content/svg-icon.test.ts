// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { ProviderIcon } from '@/lib/provider-icons';
import { engineMark, SVG_NS, showMark } from './svg-icon';

const ICON: ProviderIcon = {
  viewBox: '0 0 24 24',
  paths: [
    { d: 'M0 0h24v24z', fill: '#4285F4' },
    { d: 'M1 1h2v2z', opacity: 0.3, evenOdd: true },
  ],
};

describe('engineMark', () => {
  it('draws the icon path by path, monochrome parts in the text color', () => {
    const mark = engineMark(document, { short: 'G', icon: ICON });
    expect(mark.namespaceURI).toBe(SVG_NS);
    expect(mark.tagName.toLowerCase()).toBe('svg');
    expect(mark.getAttribute('class')).toBe('pi');
    expect(mark.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    const paths = [...mark.children];
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.namespaceURI === SVG_NS)).toBe(true);
    expect(paths.map((path) => path.getAttribute('d'))).toEqual(['M0 0h24v24z', 'M1 1h2v2z']);
    expect(paths.map((path) => path.getAttribute('fill'))).toEqual(['#4285F4', 'currentColor']);
    expect(paths.map((path) => path.getAttribute('fill-opacity'))).toEqual([null, '0.3']);
    expect(paths.map((path) => path.getAttribute('fill-rule'))).toEqual([null, 'evenodd']);
    expect(mark.textContent).toBe('');
  });

  it('falls back to the short label in a square', () => {
    const mark = engineMark(document, { short: '本地' });
    expect(mark.tagName.toLowerCase()).toBe('span');
    expect(mark.className).toBe('pi pf');
    expect(mark.textContent).toBe('本地');
    expect(mark.querySelector('svg')).toBeNull();
  });
});

describe('showMark', () => {
  it('shows "…" until there is an option, and redraws only when the option changes', () => {
    const slot = document.createElement('span');
    showMark(document, slot, undefined);
    expect(slot.textContent).toBe('…');
    const google = { short: 'G', icon: ICON };
    showMark(document, slot, google);
    const drawn = slot.firstElementChild;
    expect(drawn?.tagName.toLowerCase()).toBe('svg');
    showMark(document, slot, google);
    expect(slot.firstElementChild).toBe(drawn);
    showMark(document, slot, { short: 'DS' });
    expect(slot.textContent).toBe('DS');
    expect(slot.querySelector('svg')).toBeNull();
  });
});
