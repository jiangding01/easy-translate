// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PROVIDER_ICONS } from '@/lib/provider-icons';
import { ProviderIcon } from './ProviderIcon';
import { Select, type SelectOption } from './Select';

// No DOM: the static markup is enough to see what the trigger and the list draw.

const icon = (id: string) => createElement('i', { 'data-icon': id });

function render(options: SelectOption<string>[], value = 'b') {
  const html = renderToStaticMarkup(
    createElement(Select<string>, { value, options, onChange: () => {}, label: '引擎' }),
  );
  const host = new DOMParser().parseFromString(html, 'text/html').body;
  return {
    trigger: host.querySelector('button') as HTMLElement,
    rows: [...host.querySelectorAll('[role="option"]')],
  };
}

describe('Select icons', () => {
  it('draws an option icon in its list row and, when selected, in the trigger', () => {
    const { trigger, rows } = render([
      { value: 'a', label: 'A', icon: icon('a') },
      { value: 'b', label: 'B', icon: icon('b') },
      { value: 'c', label: 'C' },
    ]);
    expect(trigger.querySelectorAll('[data-icon]')).toHaveLength(1);
    expect(trigger.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('b');
    expect(rows.map((row) => row.firstElementChild?.getAttribute('data-icon') ?? null)).toEqual([
      'a',
      'b',
      null,
    ]);
    // Before the selected label.
    expect(trigger.querySelector('[data-icon] + span')?.textContent).toBe('B');
  });

  it('draws no icon for options without one', () => {
    const { trigger, rows } = render([{ value: 'b', label: 'B' }]);
    expect(trigger.querySelector('[data-icon]')).toBeNull();
    expect(rows[0]?.querySelector('[data-icon]')).toBeNull();
  });
});

describe('ProviderIcon', () => {
  const markup = (props: Parameters<typeof ProviderIcon>[0]) =>
    new DOMParser().parseFromString(
      renderToStaticMarkup(createElement(ProviderIcon, props)),
      'text/html',
    ).body;

  it('draws the paths, monochrome ones in the text color', () => {
    const body = markup({ icon: PROVIDER_ICONS.lmstudio, fallback: 'x' });
    const paths = [...body.querySelectorAll('svg > path')];
    expect(paths).toHaveLength(2);
    expect(paths.map((path) => path.getAttribute('fill'))).toEqual([
      'currentColor',
      'currentColor',
    ]);
    expect(paths.map((path) => path.getAttribute('fill-opacity'))).toEqual(['0.3', null]);
    expect(paths.every((path) => path.getAttribute('fill-rule') === 'evenodd')).toBe(true);
    expect(body.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(body.textContent).toBe('');
  });

  it('shows the fallback label without an icon', () => {
    const body = markup({ icon: undefined, fallback: '本地' });
    expect(body.querySelector('svg')).toBeNull();
    expect(body.textContent).toBe('本地');
  });
});
