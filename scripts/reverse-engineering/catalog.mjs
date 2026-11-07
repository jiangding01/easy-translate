import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const evidence = resolve(import.meta.dirname, '../../evidence/legacy');
const inventory = JSON.parse(await readFile(resolve(evidence, 'inventory.json'), 'utf8'));
const symbols = [], strings = [];
const bgText = await readFile(resolve(evidence, 'formatted/background.js'), 'utf8');
let bg;
const declarations = new Map();
function linesOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return position => {
    let lo = 0, hi = starts.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (starts[mid] <= position) lo = mid; else hi = mid; }
    return lo + 1;
  };
}
for (const entry of inventory.files.filter(x => x.formatted)) {
  const text = await readFile(resolve(evidence, entry.formatted), 'utf8');
  const file = ts.createSourceFile(entry.path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const lineAt = linesOf(text);
  if (entry.path === 'background.js') bg = file;
  function visit(node) {
    const start = node.getStart(file);
    const line = lineAt(start);
    if (ts.isStringLiteralLike(node) && node.text.length >= 3) strings.push({ path: entry.path, line, value: node.text });
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) {
      symbols.push({ path: entry.path, name: node.name?.getText(file) ?? '(anonymous)', kind: ts.SyntaxKind[node.kind],
        startLine: line, endLine: lineAt(node.getEnd()) });
    }
    if (entry.path === 'background.js' && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (line >= 2540 && line <= 2710 || node.name.text === 'he' && line === 1300) declarations.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}

// Interpret only literal AST forms. No eval, calls, imports, or target execution.
function literal(node, seen = new Set()) {
  if (!node) return { $unknown: 'missing node' };
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined') return { $undefined: true };
    if (seen.has(node.text)) return { $unknown: 'recursive reference' };
    const next = new Set(seen).add(node.text);
    return declarations.has(node.text) ? literal(declarations.get(node.text), next) : { $expression: node.getText(bg) };
  }
  if (ts.isVoidExpression(node)) return { $undefined: true };
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = literal(node.operand, seen);
    if (node.operator === ts.SyntaxKind.ExclamationToken && typeof operand !== 'object') return !operand;
    if (node.operator === ts.SyntaxKind.MinusToken && typeof operand === 'number') return -operand;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(x => literal(x, seen));
  if (ts.isObjectLiteralExpression(node)) {
    const result = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) result[prop.name.text ?? prop.name.getText(bg)] = literal(prop.initializer, seen);
      else result.$expression = node.getText(bg);
    }
    return result;
  }
  if (ts.isElementAccessExpression(node)) {
    const value = literal(node.expression, seen), key = literal(node.argumentExpression, seen);
    if (Array.isArray(value) && typeof key === 'number') return value[key];
  }
  if (ts.isPropertyAccessExpression(node)) {
    const value = literal(node.expression, seen);
    if (value && typeof value === 'object' && Object.hasOwn(value, node.name.text)) return value[node.name.text];
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const item = literal(span.expression, seen);
      if (typeof item === 'object') return { $expression: node.getText(bg) };
      value += item + span.literal.text;
    }
    return value;
  }
  return { $expression: node.getText(bg) };
}
const output = resolve(evidence, 'extracts/platform');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'default-config.json'), JSON.stringify({
  source: 'formatted/background.js', line: 2702, symbol: 'zt', convention: 'Literal AST interpretation; $expression is unresolved, $undefined is JS undefined',
  value: literal(declarations.get('zt')),
}, null, 2) + '\n');
await writeFile(resolve(output, 'runtime-message-names.json'), JSON.stringify({
  source: 'formatted/background.js', line: 1300, symbol: 'he', values: literal(declarations.get('he')),
}, null, 2) + '\n');
await writeFile(resolve(output, 'schemas-and-enums.json'), JSON.stringify(Object.fromEntries(
  [...declarations].filter(([name]) => ['xn','dI','mI','hI','gI','fI','yI','vI','kI','jl','wI','TI','th','rh','II','ih','FI','LI','Zm','Gm','_n','Wm','Vm','Km','Jm','Ym','Xm','Ol','Qm'].includes(name))
    .map(([name, node]) => [name, { line: linesOf(bgText)(node.getStart(bg)), expression: node.getText(bg) }])
), null, 2) + '\n');
await writeFile(resolve(evidence, 'symbols.json'), JSON.stringify(symbols, null, 2) + '\n');
await writeFile(resolve(evidence, 'strings.json'), JSON.stringify(strings, null, 2) + '\n');
console.log(`Catalogued ${symbols.length} symbols and ${strings.length} strings using LF-only line numbering; extracted defaults, schemas, messages without target execution.`);
