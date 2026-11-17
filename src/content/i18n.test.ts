import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createGetMessage, loadLocales, substitute } from '../../scripts/i18n-messages.mjs';
import {
  type MessageFn,
  message,
  type NoArgKey,
  type PluralFn,
  pickPlural,
  pluralMessage,
} from './i18n';

type GetMessage = typeof fakeBrowser.i18n.getMessage;
const original = fakeBrowser.i18n.getMessage;

/** Serves `table` (message name → text) with Chrome's substitution rules. */
function serve(table: Record<string, string>) {
  const getMessage = vi.fn((name: string, substitutions?: string | string[]) =>
    substitute(table[name] ?? '', substitutions),
  );
  fakeBrowser.i18n.getMessage = getMessage as unknown as GetMessage;
  return getMessage;
}

afterEach(() => {
  fakeBrowser.i18n.getMessage = original;
});

describe('message', () => {
  it('reads the zh_CN copy in tests', () => {
    expect(message('meta.locale')).toBe('zh-CN');
    expect(message('manifest.commands.translatePage')).toBe('翻译此页 / 显示原文');
  });

  it('reads the en copy when Chrome picked en', async () => {
    fakeBrowser.i18n.getMessage = createGetMessage(await loadLocales(), 'en') as GetMessage;
    expect(message('meta.locale')).toBe('en');
    expect(message('manifest.commands.translateSelection')).toBe('Translate selected text');
  });

  it('turns the dotted key into the message name and passes the substitutions', () => {
    const getMessage = serve({ card_tooLong: 'Over $1 characters' });
    expect(message('card.tooLong' as never, '2000' as never)).toBe('Over 2000 characters');
    expect(getMessage).toHaveBeenCalledWith('card_tooLong', ['2000']);
  });
});

describe('pluralMessage', () => {
  it('picks the form for the count and fills $1 with it', () => {
    serve({ isle_failed: 'Retry $1 paragraph | Retry $1 paragraphs' });
    const failed = (count: number) => pluralMessage('isle.failed' as never, count);
    expect(failed(1)).toBe('Retry 1 paragraph');
    expect(failed(3)).toBe('Retry 3 paragraphs');
    expect(failed(0)).toBe('Retry 0 paragraphs');
  });

  it('fills $1 with the given text instead, e.g. a formatted count', () => {
    serve({ cache_count: '$1 translation | $1 translations' });
    expect(pluralMessage('cache.count' as never, 1234, ...(['1,234'] as never[]))).toBe(
      '1,234 translations',
    );
  });

  it('uses the only form a language has', () => {
    serve({ isle_failed: '重试 $1 段' });
    expect(pluralMessage('isle.failed' as never, 1)).toBe('重试 1 段');
  });
});

describe('pickPlural', () => {
  it('follows @wxt-dev/i18n: 1 | n, and 0 | 1 | n', () => {
    expect(pickPlural('one | many', 1)).toBe('one');
    expect(pickPlural('one | many', 2)).toBe('many');
    expect(pickPlural('one | many', 0)).toBe('many');
    expect(pickPlural('none | one | many', 0)).toBe('none');
    expect(pickPlural('none | one | many', 1)).toBe('one');
    expect(pickPlural('none | one | many', 5)).toBe('many');
  });

  it('leaves a single form alone', () => {
    expect(pickPlural('3 段没有译出', 3)).toBe('3 段没有译出');
    expect(pickPlural('a|b', 1)).toBe('a|b');
  });
});

// Types only: a made-up structure with substitutions and plurals (the real locale files have
// none yet). The function is never run; tsc checks every @ts-expect-error.
type Fake = {
  'a.none': { substitutions: 0; plural: false };
  'a.none2': { substitutions: 0; plural: false };
  'a.one': { substitutions: 1; plural: false };
  'a.two': { substitutions: 2; plural: false };
  'a.items': { substitutions: 1; plural: true };
  'a.itemsIn': { substitutions: 2; plural: true };
  'a.named': { substitutions: 0; plural: false; namedSubstitutions: ['who'] };
  '@@ui_locale': { substitutions: 0; plural: false };
};

function typeChecks(m: MessageFn<Fake>, p: PluralFn<Fake>, noArg: 'a.none' | 'a.none2') {
  const keys: NoArgKey<Fake>[] = ['a.none', 'a.none2'];
  // @ts-expect-error a key with substitutions is not a NoArgKey
  const withArgs: NoArgKey<Fake> = 'a.one';
  // @ts-expect-error a plural key is not a NoArgKey
  const plural: NoArgKey<Fake> = 'a.items';

  m('a.none');
  m('a.one', 'x');
  m('a.two', 'x', 'y');
  m(noArg);
  // @ts-expect-error missing $1
  m('a.one');
  // @ts-expect-error missing $2
  m('a.two', 'x');
  // @ts-expect-error no substitutions on this key
  m('a.none', 'x');
  const union = keys.length > 0 ? ('a.one' as const) : ('a.two' as const);
  // @ts-expect-error a union of keys with substitutions: call each key on its own
  m(union, 'x');
  const mixed = keys.length > 0 ? ('a.none' as const) : ('a.one' as const);
  // @ts-expect-error a union is only allowed when every key takes no substitutions
  m(mixed);
  // @ts-expect-error {name} substitutions are not supported here
  m('a.named');
  // @ts-expect-error Chrome's predefined messages are not content keys
  m('@@ui_locale');
  // @ts-expect-error plural keys go through pluralMessage
  m('a.items', 'x');

  p('a.items', 3);
  p('a.items', 3, '3');
  p('a.itemsIn', 3, '3', 'x');
  // @ts-expect-error count fills $1 only: $2 must be passed
  p('a.itemsIn', 3);
  // @ts-expect-error not a plural key
  p('a.one', 1);
  return [withArgs, plural];
}

describe('types', () => {
  it('are checked by tsc (typeChecks above)', () => {
    expect(typeChecks).toBeTypeOf('function');
  });
});
