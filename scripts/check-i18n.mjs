// UI copy checks (docs/plans/i18n.md 4.10). Two parts:
//
// 1. No new Chinese in source. Every string, template and JSX text in src/**/*.{ts,tsx,html}
//    (tests excluded) and wxt.config.ts is read with the TypeScript parser (decoded, so escapes
//    and character references count; comments and regular expressions never do). A literal is
//    exempt when a comment `i18n-ignore: <reason>` sits on its line or the line above. Copy not
//    migrated yet is listed in scripts/i18n-baseline.json as a multiset of text hashes, not
//    tied to files (so moving a file is fine): every literal must match one entry, and once
//    copy moves to src/locales the baseline must shrink (`--update-baseline`, which never adds).
// 2. The locale files agree: same keys and placeholders, `meta.locale` matching the file name,
//    no colliding message names, no " | " in text (it separates plural forms), no empty text,
//    `$` only as `$$` or `$1`–`$9`, values YAML would change must be quoted.
//
// Usage: node scripts/check-i18n.mjs [--update-baseline | --init-baseline]
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { DEFAULT_LOCALE, LOCALES_DIR, loadLocales } from './i18n-messages.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const BASELINE_FILE = resolve(ROOT, 'scripts/i18n-baseline.json');
// Han, CJK punctuation (and the ideographic space), kana, bopomofo, full-width forms.
const CJK = /[\p{Script=Han}\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u31A0-\u31BF\uFF00-\uFFEF]/u;
const IGNORE = /i18n-ignore:\s*\S/;

// ---------------------------------------------------------------- source

/** Numeric character references (`&#20013;`, `&#x4e2d;`), as JSX and HTML decode them. */
function decodeReferences(text) {
  return text.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (match, hex, decimal) => {
    const code = hex ? Number.parseInt(hex, 16) : Number(decimal);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

const collapse = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * 0-based lines a comment exempts: its own lines, plus the next one when the comment stands
 * alone on its line(s) (a trailing comment covers only the code before it).
 */
function exemptLines(text, lineOf, comments) {
  const lines = new Set();
  for (const { pos, end } of comments) {
    const first = lineOf(pos);
    const last = lineOf(end);
    const before = text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos);
    const lineEnd = text.indexOf('\n', end);
    const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
    // `{/* … */}` in JSX stands alone too.
    const alone = /^\s*\{?\s*$/.test(before) && /^\s*\}?\s*$/.test(after);
    for (let line = first; line <= (alone ? last + 1 : last); line += 1) lines.add(line);
  }
  return lines;
}

function findInHtml(text) {
  const blank = (part) => part.replace(/[^\n]/g, ' ');
  const lineOf = (offset) => text.slice(0, offset).split('\n').length - 1;
  const comments = [...text.matchAll(/<!--[\s\S]*?-->/g)]
    .filter((match) => IGNORE.test(match[0]))
    .map((match) => ({ pos: match.index, end: match.index + match[0].length }));
  const exempt = exemptLines(text, lineOf, comments);
  // Comments out, keeping offsets: HTML's, then CSS and script comments inside their elements.
  const body = text
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_, open, tag, inner, close) => {
      const code = inner.replace(/\/\*[\s\S]*?\*\//g, blank);
      return (
        open + (tag.toLowerCase() === 'script' ? code.replace(/\/\/[^\n]*/g, blank) : code) + close
      );
    });
  const found = [];
  for (const match of body.matchAll(/[^<>]+/g)) {
    const decoded = decodeReferences(match[0]);
    if (!CJK.test(decoded)) continue;
    const line = lineOf(match.index + Math.max(0, match[0].search(/\S/)));
    if (!exempt.has(line)) found.push({ line: line + 1, text: collapse(decoded) });
  }
  return found;
}

/**
 * CJK-bearing literals in a .ts/.tsx/.html file: `[{ line, text }]`, 1-based lines, `text`
 * decoded (templates as `a {} b`, JSX text whitespace-collapsed): what the baseline hashes.
 */
export function findHanLiterals(text, fileName) {
  if (fileName.endsWith('.html')) return findInHtml(text);
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (offset) => source.getLineAndCharacterOfPosition(offset).line;

  // Comment tokens only. JSX text can look like a comment ("// x"), so ranges starting in it
  // are dropped; `{/* … */}` is read between its braces.
  const jsxText = [];
  const comments = new Map();
  const addComments = (ranges) => {
    for (const range of ranges ?? []) comments.set(range.pos, range);
  };
  const literals = [];
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      jsxText.push([node.pos, node.end]);
      literals.push({ node, text: collapse(decodeReferences(node.text)) });
      return;
    }
    if (ts.isJsxExpression(node) && !node.expression) {
      // Right after `{`: "trailing" in TypeScript's terms (leading ones need a line break).
      addComments(ts.getTrailingCommentRanges(text, node.getStart(source) + 1));
      addComments(ts.getLeadingCommentRanges(text, node.getStart(source) + 1));
      return;
    }
    // Both kinds at both ends: a comment after `},` is trailing trivia of the comma, which is
    // no node, so it is only seen from the next node's start.
    for (const at of [node.pos, node.end]) {
      addComments(ts.getLeadingCommentRanges(text, at));
      addComments(ts.getTrailingCommentRanges(text, at));
    }
    // And after punctuation tokens: a comment after the last `],` of an array sits before
    // the closing bracket, a token no node starts at.
    const tokensIn = (children) => {
      for (const child of children) {
        if (child.kind === ts.SyntaxKind.SyntaxList) tokensIn(child.getChildren(source));
        else if (child.kind <= ts.SyntaxKind.LastToken) {
          addComments(ts.getTrailingCommentRanges(text, child.end));
        }
      }
    };
    tokensIn(node.getChildren(source));
    if (ts.isStringLiteral(node)) {
      const inJsx = ts.isJsxAttribute(node.parent);
      literals.push({ node, text: inJsx ? decodeReferences(node.text) : node.text });
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push({ node, text: node.text ?? node.rawText ?? '' });
    } else if (ts.isTemplateExpression(node)) {
      // One literal however many parts carry text; the expressions are visited on their own.
      const parts = [node.head, ...node.templateSpans.map((span) => span.literal)];
      const cooked = parts.map((part) => part.text ?? part.rawText ?? '').join('{}');
      literals.push({ node, text: cooked });
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const inJsxText = (pos) => jsxText.some(([start, end]) => pos >= start && pos < end);
  const ignoreComments = [...comments.values()].filter(
    (range) => !inJsxText(range.pos) && IGNORE.test(text.slice(range.pos, range.end)),
  );
  const exempt = exemptLines(text, lineOf, ignoreComments);
  const found = [];
  for (const { node, text: literal } of literals) {
    if (!CJK.test(literal)) continue;
    // The line of the first CJK character as written; the start when it is escaped.
    const raw = node.getText(source);
    const offset = raw.search(CJK) >= 0 ? raw.search(CJK) : raw.search(/\S/);
    const line = lineOf(node.getStart(source) + Math.max(0, offset));
    if (!exempt.has(line)) found.push({ line: line + 1, text: literal });
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Files under the scan: src/**\/*.{ts,tsx,html} except tests, plus wxt.config.ts. */
export async function sourceFiles(root = ROOT) {
  const entries = await readdir(resolve(root, 'src'), { recursive: true });
  const files = entries
    .map((entry) => `src/${entry.split('\\').join('/')}`)
    .filter((file) => /\.(tsx?|html)$/.test(file) && !/\.test\.tsx?$/.test(file));
  return [...files, 'wxt.config.ts'].sort();
}

export function literalHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Every literal not migrated yet: `[{ file, line, text, hash }]`, by file and line. */
export async function collectLiterals(root = ROOT) {
  const literals = [];
  for (const file of await sourceFiles(root)) {
    for (const { line, text } of findHanLiterals(
      await readFile(resolve(root, file), 'utf8'),
      file,
    )) {
      literals.push({ file, line, text, hash: literalHash(text) });
    }
  }
  return literals;
}

// ---------------------------------------------------------------- baseline

const HASH = /^[0-9a-f]{16}$/;
const BASELINE_NOTE =
  'Hashes of the Chinese literals not yet moved to src/locales (scripts/check-i18n.mjs), with ' +
  'their counts. It may only shrink: run `npm run check:i18n -- --update-baseline` after migrating.';

/** `Map<hash, count>` from the baseline file; throws on anything but the expected shape. */
export function parseBaseline(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('i18n baseline: not valid JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('i18n baseline: expected an object');
  }
  const extra = Object.keys(data).filter((key) => key !== '$comment' && key !== 'literals');
  if (extra.length > 0) throw new Error(`i18n baseline: unexpected ${extra.join(', ')}`);
  const { literals } = data;
  if (typeof literals !== 'object' || literals === null || Array.isArray(literals)) {
    throw new Error('i18n baseline: "literals" must be an object of hash → count');
  }
  const map = new Map();
  for (const [hash, count] of Object.entries(literals)) {
    if (!HASH.test(hash) || !Number.isInteger(count) || count < 1) {
      throw new Error(`i18n baseline: bad entry ${JSON.stringify(hash)}: ${JSON.stringify(count)}`);
    }
    map.set(hash, count);
  }
  return map;
}

function serializeBaseline(map) {
  const literals = Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : 1)));
  return `${JSON.stringify({ $comment: BASELINE_NOTE, literals }, null, 2)}\n`;
}

const countHashes = (literals) => {
  const map = new Map();
  for (const { hash } of literals) map.set(hash, (map.get(hash) ?? 0) + 1);
  return map;
};

/**
 * Matches literals one by one against the baseline. `unknown`: literals with no entry left (new
 * or changed copy). `stale`: entries no literal used (copy migrated; shrink the baseline).
 */
export function compareBaseline(literals, baseline) {
  const left = new Map(baseline);
  const unknown = [];
  for (const literal of literals) {
    const count = left.get(literal.hash) ?? 0;
    if (count > 0) left.set(literal.hash, count - 1);
    else unknown.push(literal);
  }
  const stale = [...left]
    .filter(([, count]) => count > 0)
    .map(([hash, count]) => ({ hash, count }));
  return { unknown, stale };
}

/** The baseline for `literals`, only if it removes entries and adds none. */
export function shrinkBaseline(baseline, literals) {
  const { unknown } = compareBaseline(literals, baseline);
  return unknown.length > 0
    ? { ok: false, added: unknown }
    : { ok: true, baseline: countHashes(literals) };
}

// ---------------------------------------------------------------- locale files

const SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;
// Plain scalars YAML 1.2 does not keep as the same text, or that read as non-text.
const NON_TEXT =
  /^(?:[-+]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|true|false|True|False|TRUE|FALSE|null|Null|NULL|~|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN)|\d{4}-\d\d-\d\d|\d{4}-\d\d?-\d\d?(?:[Tt]|[ \t]+)\d\d?:\d\d:\d\d(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d\d)?))?)$/;

/** Files in src/locales that are not `<locale>.yml` (dotfiles aside). */
export function localeDirProblems(names) {
  return names
    .filter((name) => !name.startsWith('.') && !/^[A-Za-z]+(?:_[A-Za-z0-9]+)?\.yml$/.test(name))
    .map((name) => `src/locales/${name}: only <locale>.yml files belong here`);
}

/** The texts of a parsed message (each plural form separately). */
function textsOf(message) {
  return message.type === 'plural' ? Object.values(message.plurals).map(String) : [message.message];
}

/** `{$1,$3}`: the numbered placeholders a message uses. */
function placeholders(message) {
  const used = new Set();
  for (const text of textsOf(message)) {
    for (const [, token] of text.matchAll(/\$(\$|[1-9])/g)) if (token !== '$') used.add(token);
  }
  return `{${[...used]
    .sort()
    .map((n) => `$${n}`)
    .join(',')}}`;
}

/** Problems with `$` in one text: Chrome reads `$…$` as a named placeholder. */
export function dollarProblems(text) {
  if (text.includes('$$$')) return ['"$$$" is ambiguous; reword around the placeholder'];
  const bad = text.replace(/\$\$|\$[1-9]/g, '').includes('$');
  return bad ? ['a literal "$" must be written "$$"; placeholders are $1–$9'] : [];
}

const unquote = (key) =>
  key.startsWith('"')
    ? JSON.parse(key)
    : key.startsWith("'")
      ? key.slice(1, -1).replaceAll("''", "'")
      : key;

/**
 * Lines of a locale file whose value YAML would not read back as written: a " #" comment
 * cutting it short, numbers, booleans, dates; and flow collections, anchors and tags, which we
 * do not use. Compares each plain value with what @wxt-dev/i18n parsed (`messages`).
 */
export function yamlValueProblems(yamlText, messages) {
  const parsed = new Map();
  for (const message of messages) {
    if (message.type === 'simple') parsed.set(message.key.join('.'), message.message);
    if (message.type === 'plural') {
      for (const [form, text] of Object.entries(message.plurals)) {
        parsed.set([...message.key, form].join('.'), String(text));
      }
    }
  }
  const problems = [];
  const stack = [];
  let blockIndent = -1;
  const KEY_LINE =
    /^( *)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"{}[\],&*!|>][^:]*?)\s*:(?:\s+(.*?))?\s*$/;
  yamlText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*(?:#.*)?$/.test(line)) return;
      const indent = line.length - line.trimStart().length;
      if (blockIndent >= 0) {
        if (indent > blockIndent) return;
        blockIndent = -1;
      }
      const where = `line ${index + 1}:`;
      const match = KEY_LINE.exec(line);
      if (!match) {
        problems.push(`${where} write each value as "key: value" on one line`);
        return;
      }
      const [, , rawKey, value = ''] = match;
      while (stack.length > 0 && (stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
      const path = [...stack.map((entry) => entry.key), unquote(rawKey)].join('.');
      if (value === '' || value.startsWith('#')) {
        stack.push({ indent, key: unquote(rawKey) });
      } else if (value.startsWith('|') || value.startsWith('>')) {
        blockIndent = indent;
      } else if (value.startsWith('{') || value.startsWith('[')) {
        problems.push(`${where} write nested keys on their own lines, not { } or [ ]`);
      } else if (/^[&*!]/.test(value)) {
        problems.push(`${where} no YAML anchors, aliases or tags`);
      } else if (!value.startsWith('"') && !value.startsWith("'")) {
        const read = parsed.get(path);
        if (read !== undefined && read !== value) {
          problems.push(
            `${where} YAML reads ${JSON.stringify(value)} as ${JSON.stringify(read)}; quote the value`,
          );
        } else if (NON_TEXT.test(value)) {
          problems.push(
            `${where} YAML reads ${JSON.stringify(value)} as a number, date or keyword; quote the value`,
          );
        }
      }
    });
  return problems;
}

/**
 * Checks parsed locale files (`[{ locale, messages, yamlText? }]`, as loadLocales returns plus
 * the raw text). Returns problem strings; empty when the files agree.
 */
export function checkLocales(locales, defaultLocale = DEFAULT_LOCALE) {
  const problems = [];
  const reference = locales.find((entry) => entry.locale === defaultLocale);
  if (!reference) return [`missing the default locale file ${defaultLocale}.yml`];
  const own = (entry) => entry.messages.filter((message) => !message.key[0]?.startsWith('@@'));
  const byKey = (entry) => new Map(own(entry).map((message) => [message.key.join('.'), message]));
  const expected = byKey(reference);

  for (const entry of locales) {
    const where = `${entry.locale}.yml`;
    const messages = byKey(entry);
    if (entry.yamlText !== undefined) {
      for (const problem of yamlValueProblems(entry.yamlText, entry.messages)) {
        problems.push(`${where} ${problem}`);
      }
    }
    const locale = entry.locale.replaceAll('_', '-');
    const meta = messages.get('meta.locale');
    if (meta === undefined && entry === reference) {
      problems.push(`${where} is missing "meta.locale" (expected "${locale}")`);
    } else if (meta !== undefined && meta.message !== locale) {
      problems.push(`${where} "meta.locale" must be "${locale}", not "${meta.message}"`);
    }
    const names = new Map();
    for (const [key, message] of messages) {
      if (message.type === 'chrome') {
        problems.push(`${where} "${key}": write it as nested keys, not {message, description}`);
        continue;
      }
      if (!message.key.every((segment) => SEGMENT.test(segment))) {
        problems.push(`${where} "${key}": key segments must match [A-Za-z][A-Za-z0-9]*`);
      }
      const name = message.key.join('_').toLowerCase();
      if (names.has(name)) {
        problems.push(`${where} "${key}" and "${names.get(name)}" are the same message name`);
      }
      names.set(name, key);
      const texts = textsOf(message);
      if (texts.some((text) => text.trim() === '')) problems.push(`${where} "${key}" is empty`);
      if (texts.some((text) => text.includes(' | '))) {
        problems.push(`${where} "${key}": " | " separates plural forms; reword the text`);
      }
      for (const text of texts) {
        for (const problem of dollarProblems(text)) problems.push(`${where} "${key}": ${problem}`);
      }
      if (message.type === 'plural') {
        const forms = Object.keys(message.plurals);
        if (!forms.includes('n') || forms.some((form) => !['0', '1', 'n'].includes(form))) {
          problems.push(`${where} "${key}": plural forms are 0, 1 and n (n required)`);
        }
      }
      if (entry === reference) continue;
      const base = expected.get(key);
      if (!base) {
        problems.push(`${where} "${key}" is not in ${defaultLocale}.yml`);
        continue;
      }
      if (placeholders(message) !== placeholders(base)) {
        problems.push(
          `${where} "${key}": uses ${placeholders(message)} but ${defaultLocale}.yml uses ${placeholders(base)}`,
        );
      }
      const named = (item) => [...item.namedSubstitutions].sort().join(',');
      if (named(message) !== named(base)) {
        problems.push(`${where} "${key}": {named} placeholders differ from ${defaultLocale}.yml`);
      }
      if (message.type === 'plural' && base.type !== 'plural') {
        problems.push(`${where} "${key}" is plural but not in ${defaultLocale}.yml`);
      }
    }
    if (entry !== reference) {
      for (const key of expected.keys()) {
        if (!messages.has(key)) problems.push(`${where} is missing "${key}"`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- main

const where = (literal) => `  ${literal.file}:${literal.line} ${literal.text.slice(0, 60)}`;

async function checkBaseline(argv, literals) {
  const failures = [];
  const baselinePath = relative(ROOT, BASELINE_FILE);
  const stored = await readFile(BASELINE_FILE, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (argv.includes('--init-baseline')) {
    if (stored !== undefined) return [`${baselinePath} exists; use --update-baseline to shrink it`];
    await writeFile(BASELINE_FILE, serializeBaseline(countHashes(literals)));
    console.log(`i18n baseline created: ${literals.length} literals.`);
    return [];
  }
  if (stored === undefined)
    return [`Missing ${baselinePath} (create it once with --init-baseline)`];
  let baseline;
  try {
    baseline = parseBaseline(stored);
  } catch (error) {
    return [`${baselinePath}: ${error.message}`];
  }
  if (argv.includes('--update-baseline')) {
    const result = shrinkBaseline(baseline, literals);
    if (!result.ok) {
      return [
        'Refusing to add to the baseline; move this copy to src/locales:',
        ...result.added.map(where),
      ];
    }
    await writeFile(BASELINE_FILE, serializeBaseline(result.baseline));
    console.log(`i18n baseline updated: ${literals.length} literals.`);
    return [];
  }
  const { unknown, stale } = compareBaseline(literals, baseline);
  if (unknown.length > 0) {
    failures.push('Chinese text not in the baseline (new or changed); use src/locales:');
    failures.push(...unknown.map(where));
  }
  if (stale.length > 0) {
    const count = stale.reduce((sum, entry) => sum + entry.count, 0);
    failures.push(
      `${count} baseline entries no longer used (copy migrated): run npm run check:i18n -- --update-baseline`,
    );
  }
  return failures;
}

async function main(argv) {
  const failures = [...localeDirProblems(await readdir(LOCALES_DIR))];
  const locales = await Promise.all(
    (await loadLocales()).map(async (entry) => ({
      ...entry,
      yamlText: await readFile(entry.file, 'utf8'),
    })),
  );
  failures.push(...checkLocales(locales));
  const literals = await collectLiterals();
  failures.push(...(await checkBaseline(argv, literals)));

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(
    `i18n check passed: ${locales.length} locales agree (${relative(ROOT, LOCALES_DIR)}); ` +
      `${literals.length} Chinese literals left to migrate.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
