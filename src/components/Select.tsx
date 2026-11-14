import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import styles from './Select.module.css';
import { listKey, placeList, typeahead } from './select-model';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Faint text after the label (a code, a status). */
  sub?: string;
  dot?: 'ok' | 'warn' | 'idle';
  lang?: string;
}

interface Props<T extends string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name: either a visible label's id or a text label. */
  labelledBy?: string;
  label?: string;
  id?: string;
  /** field: settings rows · inline: bold text in a sentence · quiet: small footer control. */
  variant?: 'field' | 'inline' | 'quiet';
  align?: 'start' | 'end';
  /** Minimum list width in px (the trigger may be narrower). */
  minWidth?: number;
  /** Replaces the selected label inside the trigger. */
  children?: ReactNode;
}

const OPTION_HEIGHT = 32;

function hide(element: HTMLElement | null) {
  if (element?.matches(':popover-open')) element.hidePopover();
}
const LIST_PADDING = 10;
const TYPEAHEAD_MS = 500;

/**
 * The extension's own select (never the native one): a button plus a listbox in
 * the top layer (`popover="auto"`), so cards and dialogs never clip it and the
 * browser handles outside clicks and Esc. Keyboard: arrows, Home/End, Enter or
 * Space, Tab, Esc and type-to-select; focus returns to the trigger.
 */
export function Select<T extends string>(props: Props<T>) {
  const { value, options, onChange, variant = 'field', align = 'start' } = props;
  const listId = useId();
  const nameId = `${listId}-name`;
  const valueId = `${listId}-value`;
  // Accessible name = label + current value, like a native select reads out.
  const labelRef = props.labelledBy ?? nameId;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [side, setSide] = useState<'below' | 'above'>('below');
  const typed = useRef({ text: '', at: 0 });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  function place() {
    const element = list.current;
    if (!element || !trigger.current) return;
    const placement = placeList({
      trigger: trigger.current.getBoundingClientRect(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      listHeight: options.length * OPTION_HEIGHT + LIST_PADDING,
      minWidth: props.minWidth ?? 0,
      align,
    });
    const style = element.style;
    style.left = `${placement.left}px`;
    style.width = `${placement.width}px`;
    style.maxHeight = `${placement.maxHeight}px`;
    style.top = placement.side === 'below' ? `${placement.offset}px` : 'auto';
    style.bottom = placement.side === 'above' ? `${placement.offset}px` : 'auto';
    setSide(placement.side);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `place` reads the same inputs listed here
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const onBeforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      place();
      setActive(selectedIndex);
      typed.current = { text: '', at: 0 };
    };
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (isOpen) element.focus({ preventScroll: true });
      // Esc or an outside click: put focus back where it was, unless the user moved on.
      else if (
        document.activeElement === document.body ||
        element.contains(document.activeElement)
      ) {
        trigger.current?.focus({ preventScroll: true });
      }
    };
    // A list too short to scroll must not pass the wheel on to the page (which closes it).
    const onWheel = (event: WheelEvent) => {
      if (element.scrollHeight <= element.clientHeight) event.preventDefault();
    };
    element.addEventListener('beforetoggle', onBeforeToggle);
    element.addEventListener('toggle', onToggle);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('beforetoggle', onBeforeToggle);
      element.removeEventListener('toggle', onToggle);
      element.removeEventListener('wheel', onWheel);
    };
  }, [options.length, selectedIndex, align, props.minWidth]);

  // Scrolling the page detaches the list, so it closes; a resize (the popup window
  // growing with its content, say) only moves it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `place` is re-created each render with current inputs
  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (list.current?.contains(event.target as Node)) return;
      hide(list.current);
    };
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function choose(index: number) {
    const option = options[index];
    hide(list.current);
    trigger.current?.focus({ preventScroll: true });
    if (option && option.value !== value) onChange(option.value);
  }

  // Type-to-select also matches the code ("ja", "zh"), since most labels are not Latin.
  const searchTerms = options.map((option) =>
    [option.label, option.value, option.sub].filter((term): term is string => !!term),
  );

  function onListKeyDown(event: React.KeyboardEvent) {
    // Space continues a word being typed instead of choosing.
    const typing = event.key === ' ' && Date.now() - typed.current.at < TYPEAHEAD_MS;
    const result = typing
      ? ({ type: 'none' } as const)
      : listKey(event.key, active, options.length);
    if (result.type === 'move') {
      event.preventDefault();
      setActive(result.index);
    } else if (result.type === 'choose') {
      event.preventDefault();
      choose(result.index);
    } else if (result.type === 'close') {
      if (result.restoreFocus) event.preventDefault();
      hide(list.current);
      if (result.restoreFocus) trigger.current?.focus({ preventScroll: true });
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : '') + event.key;
      typed.current = { text, at: now };
      const index = typeahead(searchTerms, active, text);
      if (index >= 0) setActive(index);
    }
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      list.current?.showPopover();
    }
  }

  const activeId = active >= 0 ? `${listId}-${active}` : undefined;
  return (
    <>
      <button
        ref={trigger}
        id={props.id}
        type="button"
        className={`${styles.trigger} ${styles[variant]}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelRef} ${valueId}`}
        popoverTarget={listId}
        onKeyDown={onTriggerKeyDown}
      >
        {props.label && !props.labelledBy && (
          <span id={nameId} hidden>
            {props.label}
          </span>
        )}
        <span
          id={valueId}
          className={styles.value}
          lang={props.children ? undefined : selected?.lang}
        >
          {props.children ?? selected?.label ?? ''}
        </span>
        <svg
          aria-hidden="true"
          className={styles.chevron}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d="M2.5 4l2.5 2.5L7.5 4" />
        </svg>
      </button>
      <div
        ref={list}
        id={listId}
        popover="auto"
        role="listbox"
        tabIndex={-1}
        aria-labelledby={labelRef}
        aria-activedescendant={open ? activeId : undefined}
        className={styles.list}
        data-side={side}
        data-align={align}
        onKeyDown={onListKeyDown}
      >
        {options.map((option, index) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled on the listbox (aria-activedescendant)
          // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox; options are referenced by aria-activedescendant
          <div
            key={option.value}
            id={`${listId}-${index}`}
            data-index={index}
            role="option"
            aria-selected={index === selectedIndex}
            data-active={index === active}
            className={styles.option}
            onPointerMove={() => index !== active && setActive(index)}
            onClick={() => choose(index)}
          >
            {option.dot && (
              <span aria-hidden="true" className={`${styles.dot} ${styles[option.dot]}`} />
            )}
            <span className={styles.label} lang={option.lang}>
              {option.label}
            </span>
            {option.sub && <span className={styles.sub}>{option.sub}</span>}
            <svg
              aria-hidden="true"
              className={styles.check}
              width="13"
              height="13"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M3 7.3l2.6 2.6L11 4.5" />
            </svg>
          </div>
        ))}
      </div>
    </>
  );
}
