// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { protectedAncestor } from './dom-rules';

/** Builds the markup in the body and returns the element matching `selector`. */
function find(markup: string, selector: string): Element {
  document.body.innerHTML = markup;
  return document.querySelector(selector) as Element;
}

describe('protectedAncestor', () => {
  it('finds the editor around a node inside it', () => {
    const el = find('<div id="ed" contenteditable="true"><p id="x">Draft</p></div>', '#x');
    expect(protectedAncestor(el, document.body)).toBe(document.getElementById('ed'));
  });

  it('checks the element itself', () => {
    const el = find('<div id="ed" contenteditable="true">Draft</div>', '#ed');
    expect(protectedAncestor(el, document.body)).toBe(el);
  });

  it('treats an empty contenteditable and plaintext-only as editable', () => {
    const empty = find('<div id="ed" contenteditable=""><p id="x">Draft</p></div>', '#x');
    expect(protectedAncestor(empty, document.body)?.id).toBe('ed');
    const plain = find(
      '<div id="ed" contenteditable="plaintext-only"><p id="x">Draft</p></div>',
      '#x',
    );
    expect(protectedAncestor(plain, document.body)?.id).toBe('ed');
  });

  it('still finds the editor through a contenteditable="false" island inside it', () => {
    const el = find(
      '<div id="ed" contenteditable="true"><div contenteditable="false"><p id="x">Chip</p></div></div>',
      '#x',
    );
    expect(protectedAncestor(el, document.body)?.id).toBe('ed');
  });

  it('finds translate="no", .notranslate, nav, pre and data-et ancestors', () => {
    const cases: [string, string][] = [
      ['<div id="a" translate="no"><p id="x">Text</p></div>', 'a'],
      ['<div id="a" class="notranslate"><p id="x">Text</p></div>', 'a'],
      ['<nav id="a"><p id="x">Text</p></nav>', 'a'],
      ['<pre id="a"><span id="x">Text</span></pre>', 'a'],
      ['<div id="a" data-et="1"><p id="x">Text</p></div>', 'a'],
    ];
    for (const [markup, id] of cases) {
      expect(protectedAncestor(find(markup, '#x'), document.body)?.id).toBe(id);
    }
  });

  it('ignores hidden, inert and aria-hidden ancestors', () => {
    for (const attribute of ['hidden', 'inert', 'aria-hidden="true"']) {
      const el = find(`<div ${attribute}><p id="x">Text</p></div>`, '#x');
      expect(protectedAncestor(el, document.body)).toBeNull();
    }
  });

  it('returns null for an ordinary paragraph', () => {
    expect(
      protectedAncestor(find('<div><p id="x">Text</p></div>', '#x'), document.body),
    ).toBeNull();
  });

  it('does not check the stop element itself', () => {
    document.body.innerHTML = '<p id="x">Text</p>';
    document.body.className = 'notranslate';
    try {
      expect(protectedAncestor(document.getElementById('x') as Element, document.body)).toBeNull();
    } finally {
      document.body.className = '';
    }
  });
});
