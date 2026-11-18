import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMessagesText } from '@wxt-dev/i18n/build';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkLocales,
  collectLiterals,
  compareBaseline,
  dollarProblems,
  findHanLiterals,
  literalHash,
  localeDirProblems,
  parseBaseline,
  shrinkBaseline,
  sourceFiles,
  yamlValueProblems,
} from './check-i18n.mjs';
import { createGetMessage, loadLocales, substitute } from './i18n-messages.mjs';

const temps = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'check-i18n-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** `meta.locale` for a fixture file, unless it brings its own `meta`. */
const withMeta = (locale, yamlText) =>
  /^meta:/m.test(yamlText) ? yamlText : `meta:\n  locale: ${locale.replace('_', '-')}\n${yamlText}`;

/** `[{ locale, messages, yamlText }]` from `{ locale: yaml }`. */
const locales = (files) =>
  Object.entries(files).map(([locale, raw]) => {
    const yamlText = withMeta(locale, raw);
    return { locale, yamlText, messages: parseMessagesText(yamlText, 'YAML') };
  });

describe('findHanLiterals', () => {
  const lines = (text, file = 'a.ts') => findHanLiterals(text, file).map((found) => found.line);
  const texts = (text, file = 'a.ts') => findHanLiterals(text, file).map((found) => found.text);

  it('finds strings, templates and JSX text', () => {
    const source = [
      "const a = '你好';",
      'const b = `共 $' + '{n} 段`;',
      "const c = 'plain';",
      'const d = <p title="提示">正文</p>;',
      'const e = `x $' + "{ok ? '是' : 'no'} y`;",
    ].join('\n');
    // A template counts once, however many of its parts have text; nested strings count too.
    expect(lines(source, 'a.tsx')).toEqual([1, 2, 4, 4, 5]);
  });

  it('reports decoded, whitespace-collapsed text (what the baseline hashes)', () => {
    const source = ['const b = `共 $' + '{n} 段`;', 'const d = <p>', '  中文', '  文本', '</p>;'];
    expect(texts(source.join('\n'), 'a.tsx')).toEqual(['共 {} 段', '中文 文本']);
  });

  it('sees through escapes and character references', () => {
    expect(texts("const a = '\\u4e2d\\u6587';")).toEqual(['中文']);
    expect(texts("const a = '\\u{4e2d}';")).toEqual(['中']);
    expect(texts('const a = <p title="&#x4e2d;">&#20013;&#25991;</p>;', 'a.tsx')).toEqual([
      '中',
      '中文',
    ]);
  });

  it('counts CJK punctuation, full-width forms, kana and bopomofo', () => {
    for (const literal of [
      '，。！？',
      '「」',
      'ＡＢＣ',
      'ひらがな',
      'カタカナ',
      'ㄅㄆ',
      '\\u3000',
    ]) {
      expect(lines(`const a = '${literal}';`), literal).toEqual([1]);
    }
    expect(lines("const a = '한국어 English';")).toEqual([]);
  });

  it('skips comments and regular expressions', () => {
    const source = [
      '// 注释',
      '/** 文档注释 */',
      'const re = /^(?:译文|翻译)[:：]/;',
      'const range = /[⺀-鿿]/;',
    ].join('\n');
    expect(lines(source)).toEqual([]);
  });

  it('honours an i18n-ignore comment with a reason on the same line or the line above', () => {
    const source = [
      "const a = '简体中文'; // i18n-ignore: endonym",
      '// i18n-ignore: sample translation',
      "const b = '少，但更好。';",
      "const c = '没有理由'; // i18n-ignore:",
      "const d = '隔一行';",
    ].join('\n');
    expect(lines(source)).toEqual([4, 5]);
  });

  it('sees a comment after a comma or closing bracket', () => {
    const source = [
      'const LANGUAGES = [',
      "  { code: 'zh-CN', name: '简体中文' }, // i18n-ignore: endonym",
      "  { code: 'ja', name: '日本語' }, // i18n-ignore: endonym",
      "  ['「', '」'], // i18n-ignore: punctuation",
      '];',
    ].join('\n');
    expect(lines(source)).toEqual([]);
  });

  it('lets a trailing comment cover only its own line', () => {
    const source = ["const a = '简体'; // i18n-ignore: endonym", "const b = '新增中文';"].join(
      '\n',
    );
    expect(lines(source)).toEqual([2]);
    const block = ["const a = '简体'; /* i18n-ignore: endonym */", "const b = '新增中文';"].join(
      '\n',
    );
    expect(lines(block)).toEqual([2]);
  });

  it('reaches only the next line', () => {
    const source = ['// i18n-ignore: x', "const a = ['中文',", "  '第二行'];"].join('\n');
    expect(lines(source)).toEqual([3]);
  });

  it('takes i18n-ignore only from comments, never from string or template text', () => {
    expect(lines("const a = 'i18n-ignore: x'; const b = '中文';")).toEqual([1]);
    expect(lines('const a = `i18n-ignore: x\n中文`;')).toEqual([2]);
    expect(lines('const a = <p>// i18n-ignore: x</p>;\nconst b = <p>中文</p>;', 'a.tsx')).toEqual([
      2,
    ]);
  });

  it('honours a JSX comment above a JSX text', () => {
    const source = ['<T>', '  {/* i18n-ignore: sample */}', '  少，但更好。', '</T>'].join('\n');
    expect(lines(source, 'a.tsx')).toEqual([]);
  });

  it('reads HTML text and attributes, not comments', () => {
    const source = [
      '<!-- 注释 -->',
      '<title>Easy Translate · 设置</title>',
      '<meta content="说明" />',
      '<p>English &#20013;</p>',
      '<style>/* 样式注释 */ p { color: red }</style>',
      '<script>// 脚本注释',
      '/* 块注释 */ const a = 1;</script>',
      "<script>const b = '脚本文案';</script>",
    ].join('\n');
    expect(lines(source, 'index.html')).toEqual([2, 3, 4, 8]);
  });
});

describe('sourceFiles and collectLiterals', () => {
  it('scans src (not tests) and wxt.config.ts', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'src/lib'), { recursive: true });
    await writeFile(join(root, 'src/lib/a.ts'), "export const a = '中文';\n");
    await writeFile(join(root, 'src/lib/a.test.ts'), "expect('中文');\n");
    await writeFile(join(root, 'src/lib/b.css'), '/* 中文 */\n');
    await writeFile(join(root, 'src/page.html'), '<title>标题</title>\n');
    await writeFile(join(root, 'wxt.config.ts'), "export default { description: '描述' };\n");
    expect(await sourceFiles(root)).toEqual(['src/lib/a.ts', 'src/page.html', 'wxt.config.ts']);
    const literals = await collectLiterals(root);
    expect(literals.map(({ file, line, text, hash }) => [file, line, text, hash])).toEqual([
      ['src/lib/a.ts', 1, '中文', literalHash('中文')],
      ['src/page.html', 1, '标题', literalHash('标题')],
      ['wxt.config.ts', 1, '描述', literalHash('描述')],
    ]);
  });
});

describe('baseline', () => {
  const literal = (text, file = 'a.ts', line = 1) => ({
    file,
    line,
    text,
    hash: literalHash(text),
  });
  const baselineOf = (...texts) => {
    const map = new Map();
    for (const text of texts) map.set(literalHash(text), (map.get(literalHash(text)) ?? 0) + 1);
    return map;
  };

  it('hashes text into 16 hex characters', () => {
    expect(literalHash('重试')).toMatch(/^[0-9a-f]{16}$/);
    expect(literalHash('重试')).toBe(literalHash('重试'));
    expect(literalHash('重试')).not.toBe(literalHash('重试一下'));
  });

  it('catches one literal migrated and another added in the same file', () => {
    const { unknown, stale } = compareBaseline(
      [literal('旧文案一'), literal('新文案', 'a.ts', 2)],
      baselineOf('旧文案一', '旧文案二'),
    );
    expect(unknown.map(({ file, line, text }) => [file, line, text])).toEqual([
      ['a.ts', 2, '新文案'],
    ]);
    expect(stale).toEqual([{ hash: literalHash('旧文案二'), count: 1 }]);
  });

  it('catches a literal reworded or extended', () => {
    const { unknown } = compareBaseline([literal('重试一下')], baselineOf('重试'));
    expect(unknown.map(({ text }) => text)).toEqual(['重试一下']);
  });

  it('matches copies one by one, wherever the file is', () => {
    const moved = [literal('文案', 'b.ts', 7), literal('文案', 'c.ts', 9)];
    expect(compareBaseline(moved, baselineOf('文案', '文案'))).toEqual({ unknown: [], stale: [] });
    const { unknown } = compareBaseline(moved, baselineOf('文案'));
    expect(unknown.map(({ file }) => file)).toEqual(['c.ts']);
  });

  it('shrinks but never grows', () => {
    const old = baselineOf('一', '二', '二');
    expect(shrinkBaseline(old, [literal('二')])).toEqual({
      ok: true,
      baseline: baselineOf('二'),
    });
    const refused = shrinkBaseline(old, [literal('一'), literal('三', 'x.ts', 4)]);
    expect(refused.ok).toBe(false);
    expect(refused.added.map(({ file, line }) => `${file}:${line}`)).toEqual(['x.ts:4']);
  });

  it('parses a well-formed baseline', () => {
    const hash = literalHash('中文');
    const map = parseBaseline(JSON.stringify({ $comment: 'x', literals: { [hash]: 2 } }));
    expect([...map]).toEqual([[hash, 2]]);
  });

  it('rejects a malformed baseline instead of passing silently', () => {
    const hash = literalHash('中文');
    for (const bad of [
      'not json',
      '[]',
      JSON.stringify({}),
      JSON.stringify({ files: { 'a.ts': 3 } }),
      JSON.stringify({ literals: [] }),
      JSON.stringify({ literals: { [hash]: 0 } }),
      JSON.stringify({ literals: { [hash]: 1.5 } }),
      JSON.stringify({ literals: { [hash]: '1' } }),
      JSON.stringify({ literals: { nothex: 1 } }),
      JSON.stringify({ literals: {}, total: 3 }),
    ]) {
      expect(() => parseBaseline(bad), bad).toThrow(/baseline/i);
    }
  });
});

describe('checkLocales', () => {
  const en = 'card:\n  retry: Retry\n  tooLong: Over $1 characters\n';
  const zh = 'card:\n  retry: 重试\n  tooLong: 超过 $1 字\n';

  it('passes locale files that agree', () => {
    expect(checkLocales(locales({ en, zh_CN: zh }))).toEqual([]);
  });

  it('requires the same keys in every locale', () => {
    const problems = checkLocales(locales({ en, zh_CN: 'card:\n  retry: 重试\n  extra: 多余\n' }));
    expect(problems).toEqual([
      'zh_CN.yml "card.extra" is not in en.yml',
      'zh_CN.yml is missing "card.tooLong"',
    ]);
  });

  it('requires the same placeholders, compared as sets', () => {
    const problems = checkLocales(locales({ en, zh_CN: zh.replace('超过 $1 字', '太长了') }));
    expect(problems).toEqual(['zh_CN.yml "card.tooLong": uses {} but en.yml uses {$1}']);
    const gap = checkLocales(locales({ en: 'a: $1 to $3\n', zh_CN: 'a: $1 到 $2 再到 $3\n' }));
    expect(gap).toEqual(['zh_CN.yml "a": uses {$1,$2,$3} but en.yml uses {$1,$3}']);
    const named = checkLocales(locales({ en: 'hi: Hello {name}\n', zh_CN: 'hi: 你好 {who}\n' }));
    expect(named).toEqual(['zh_CN.yml "hi": {named} placeholders differ from en.yml']);
  });

  it('requires meta.locale to match the file name', () => {
    expect(checkLocales(locales({ en, zh_CN: `meta:\n  locale: zh-TW\n${zh}` }))).toEqual([
      'zh_CN.yml "meta.locale" must be "zh-CN", not "zh-TW"',
    ]);
    expect(checkLocales([{ locale: 'en', messages: parseMessagesText(en, 'YAML') }])).toEqual([
      'en.yml is missing "meta.locale" (expected "en")',
    ]);
  });

  it('rejects message names that collide once lowercased', () => {
    const problems = checkLocales(locales({ en: 'card:\n  retry: A\n  Retry: B\n' }));
    expect(problems).toEqual(['en.yml "card.Retry" and "card.retry" are the same message name']);
  });

  it('rejects key segments with "-" or "_"', () => {
    const problems = checkLocales(locales({ en: 'errors:\n  page-unreachable: A\n  a_b: B\n' }));
    expect(problems).toEqual([
      'en.yml "errors.page-unreachable": key segments must match [A-Za-z][A-Za-z0-9]*',
      'en.yml "errors.a_b": key segments must match [A-Za-z][A-Za-z0-9]*',
    ]);
  });

  it('rejects a lone "$" and "$$$"', () => {
    const problems = checkLocales(locales({ en: 'a: Costs $5 or $x\nb: "$$$1"\nc: Costs $$5\n' }));
    expect(problems).toEqual([
      'en.yml "a": a literal "$" must be written "$$"; placeholders are $1–$9',
      'en.yml "b": "$$$" is ambiguous; reword around the placeholder',
    ]);
  });

  it('rejects " | " in any text: it separates plural forms', () => {
    expect(checkLocales(locales({ en: 'a: "Retry | Skip"\n' }))).toEqual([
      'en.yml "a": " | " separates plural forms; reword the text',
    ]);
    const plural = 'items:\n  1: one item\n  n: $1 items\n';
    expect(checkLocales(locales({ en: plural, zh_CN: 'items: "$1 项 | 共"\n' }))).toEqual([
      'zh_CN.yml "items": " | " separates plural forms; reword the text',
    ]);
    expect(checkLocales(locales({ en: 'items:\n  1: "a | b"\n  n: $1 c\n' }))).toEqual([
      'en.yml "items": " | " separates plural forms; reword the text',
    ]);
  });

  it('rejects empty text', () => {
    expect(checkLocales(locales({ en: 'a: ""\nb: "  "\n' }))).toEqual([
      'en.yml "a" is empty',
      'en.yml "b" is empty',
    ]);
  });

  it('rejects values YAML would change', () => {
    const problems = checkLocales(locales({ en: 'a: Retry # note\nb: 0x1F\n' }));
    expect(problems).toEqual([
      'en.yml line 3: YAML reads "Retry # note" as "Retry"; quote the value',
      'en.yml line 4: YAML reads "0x1F" as "31"; quote the value',
    ]);
  });

  it('rejects the verbose {message, description} form', () => {
    const problems = checkLocales(locales({ en: 'notice:\n  message: Hi\n  description: D\n' }));
    expect(problems).toEqual([
      'en.yml "notice": write it as nested keys, not {message, description}',
    ]);
  });

  it('checks plural forms', () => {
    const plural = 'items:\n  1: $1 item\n  n: $1 items\n';
    expect(checkLocales(locales({ en: plural, zh_CN: 'items: $1 项\n' }))).toEqual([]);
    expect(checkLocales(locales({ en: 'items:\n  1: one\n  2: two\n' }))).toEqual([
      'en.yml "items": plural forms are 0, 1 and n (n required)',
    ]);
    expect(
      checkLocales(locales({ en: 'items: $1 items\n', zh_CN: 'items:\n  1: $1 项\n  n: $1 项\n' })),
    ).toEqual(['zh_CN.yml "items" is plural but not in en.yml']);
  });

  it('requires the default locale', () => {
    expect(checkLocales(locales({ zh_CN: zh }))).toEqual([
      'missing the default locale file en.yml',
    ]);
  });
});

describe('yamlValueProblems', () => {
  const problems = (yamlText) => yamlValueProblems(yamlText, parseMessagesText(yamlText, 'YAML'));

  it('accepts plain text, quoted values, groups, plural forms and block scalars', () => {
    const yamlText = [
      '# comment',
      'group:',
      '  title: Hello, world',
      "  quoted: '1.0' # fine after a quote",
      '  double: "Retry # not a comment"',
      '  items:',
      '    1: one item',
      '    n: $1 items',
      '  long: |',
      '    key: looks like a key',
      '    0x1F',
      'next: ok',
    ].join('\n');
    expect(problems(yamlText)).toEqual([]);
  });

  it('flags numbers, booleans, null-likes and dates written bare', () => {
    for (const value of [
      '12',
      '1.0',
      '0b101',
      '0o17',
      '017',
      '1_000',
      '1e3',
      'true',
      '2026-11-17',
    ]) {
      expect(problems(`a: ${value}\n`), value).toEqual([
        expect.stringMatching(/^line 1: .*quote the value/),
      ]);
    }
  });

  it('reads CRLF files like LF ones', () => {
    expect(problems('# c\r\nmeta:\r\n  locale: en\r\na: 12\r\n')).toEqual([
      expect.stringMatching(/^line 4: .*quote the value/),
    ]);
  });

  it('takes text that only starts with a date as text', () => {
    expect(problems('a: 2026-11-17 release notes\n')).toEqual([]);
    expect(problems('a: 2026-1-7\n')).toEqual([]);
    expect(problems('a: 2026-11-17T10:00:00Z\n')).toEqual([
      expect.stringMatching(/^line 1: .*quote the value/),
    ]);
  });

  it('flags a " #" comment cutting a value short', () => {
    expect(problems('a: Item #3 is #4\n')).toEqual([
      'line 1: YAML reads "Item #3 is #4" as "Item"; quote the value',
    ]);
  });

  it('flags flow collections', () => {
    expect(problems('a: { b: 1 }\n')).toEqual([
      'line 1: write nested keys on their own lines, not { } or [ ]',
    ]);
  });
});

describe('localeDirProblems', () => {
  it('allows only .yml locale files', () => {
    expect(localeDirProblems(['en.yml', 'zh_CN.yml'])).toEqual([]);
    expect(localeDirProblems(['en.yml', 'de.json', 'notes.md', 'fr.yaml'])).toEqual([
      'src/locales/de.json: only <locale>.yml files belong here',
      'src/locales/notes.md: only <locale>.yml files belong here',
      'src/locales/fr.yaml: only <locale>.yml files belong here',
    ]);
  });
});

describe('helpers', () => {
  it('dollarProblems accepts $$ and $1–$9', () => {
    expect(dollarProblems('$$5 and $1 and $9')).toEqual([]);
    expect(dollarProblems('$0')).toHaveLength(1);
  });

  it('rejects a placeholder followed by "$": Chrome reads "$1$" as a $name$ placeholder', () => {
    // A zh_CN value "$1$2" made Chrome refuse to load the whole extension.
    expect(dollarProblems('$1$2')).toEqual([
      '"$1$…" reads as a $name$ placeholder in Chrome; put text between',
    ]);
    expect(dollarProblems('$1$$')).toHaveLength(1);
    expect(dollarProblems('$1 $2')).toEqual([]);
  });
});

describe('the unit-test getMessage', () => {
  it('behaves like Chrome over real locale files', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'en.yml'), 'card:\n  tooLong: Over $1 characters\n  only: English\n');
    await writeFile(join(dir, 'zh_CN.yml'), 'card:\n  tooLong: 超过 $1 字\n');
    const files = await loadLocales(dir);
    expect(files.map((file) => file.locale)).toEqual(['en', 'zh_CN']);
    const getMessage = createGetMessage(files, 'zh_CN');
    expect(getMessage('card_tooLong', ['2000'])).toBe('超过 2000 字');
    expect(getMessage('CARD_TOOLONG', '9')).toBe('超过 9 字');
    // A missing substitution becomes empty, as in Chrome.
    expect(getMessage('card_tooLong')).toBe('超过  字');
    // Missing in zh_CN: Chrome falls back to the default locale.
    expect(getMessage('card_only')).toBe('English');
    expect(() => getMessage('card_nope')).toThrow('no message "card_nope"');
  });

  it('answers the predefined @@ messages for the test locale', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'en.yml'), 'a: A\n');
    const files = await loadLocales(dir);
    const zh = createGetMessage(files, 'zh_CN');
    expect(zh('@@ui_locale')).toBe('zh_CN');
    expect(zh('@@bidi_dir')).toBe('ltr');
    expect(zh('@@bidi_reversed_dir')).toBe('rtl');
    expect(zh('@@bidi_start_edge')).toBe('left');
    expect(zh('@@bidi_end_edge')).toBe('right');
    expect(zh('@@extension_id')).toMatch(/^[a-p]{32}$/);
    const ar = createGetMessage(files, 'ar');
    expect([ar('@@ui_locale'), ar('@@bidi_dir'), ar('@@bidi_start_edge')]).toEqual([
      'ar',
      'rtl',
      'right',
    ]);
  });

  it('substitutes like Chrome: $$ is a dollar sign', () => {
    expect(substitute('Costs $$5')).toBe('Costs $5');
    expect(substitute('$$1 and $1', ['S'])).toBe('$1 and S');
    expect(substitute('x $1 y $2', ['p'])).toBe('x p y ');
  });
});
