import type { SelectionSnapshot } from '../runtime-contract';

// What `selection.open` does in the top frame (plan 4.6 rule 3). Pure: the bootstrap
// reads the page and the message, this decides.

export interface OpenInput {
  /** From the context menu only; absent for the shortcut. */
  selectionText?: string;
  /** The menu's frame; absent for the shortcut. 0 is the top frame. */
  frameId?: number;
  /** `document.hasFocus()` of the top document. */
  hasFocus: boolean;
  /** The top document's current selection, extracted; undefined when empty. */
  top?: SelectionSnapshot;
}

export type OpenDecision =
  | { kind: 'ignore' }
  /** Shortcut with no selection: close the card if one is open. */
  | { kind: 'close' }
  /** The top frame's selection: the card grows from it. */
  | { kind: 'top'; selection: SelectionSnapshot }
  /** Only the text is trusted (iframe, or the top selection disagrees): upper-third placement. */
  | { kind: 'detached'; source: string };

/** The same whitespace normalization as the selection snapshot's `source`. */
export function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function decideOpen(input: OpenInput): OpenDecision {
  const { frameId, top } = input;
  if (input.selectionText === undefined) {
    // The shortcut cannot say which frame holds the selection: only the top document's
    // own selection counts, and only while it has the focus.
    if (!input.hasFocus) return { kind: 'ignore' };
    return top ? { kind: 'top', selection: top } : { kind: 'close' };
  }
  const text = normalizeSelectionText(input.selectionText);
  if (!text) return { kind: 'ignore' };
  // Right-click in an iframe: whatever the top frame still has selected is stale.
  if (frameId !== undefined && frameId !== 0) return { kind: 'detached', source: text };
  if (top && top.source === text) return { kind: 'top', selection: top };
  // The menu's text wins over a selection that disagrees (or one we cannot read, such
  // as inside a shadow root): it is what the user right-clicked.
  return { kind: 'detached', source: text };
}
