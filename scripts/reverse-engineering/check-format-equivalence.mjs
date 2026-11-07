import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const evidence = resolve(root, 'evidence/legacy');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile() && path.endsWith('.js')) result.push(path);
  }
  return result;
}
function fingerprint(text, name) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error(`${name}: ${source.parseDiagnostics.length} parse diagnostics`);
  const hash = createHash('sha256');
  const stack = [{ node: source, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop();
    // Parentheses around optional chains or directive-like strings may affect semantics.
    if (ts.isParenthesizedExpression(node) && !ts.isOptionalChain(node.expression) &&
        !(ts.isExpressionStatement(parent) && ts.isStringLiteral(node.expression))) {
      stack.push({ node: node.expression, parent });
      continue;
    }
    let value = '';
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) value = node.text;
    else if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) ||
             ts.isRegularExpressionLiteral(node) || ts.isTemplateLiteralToken(node)) value = node.getText(source);
    else if (ts.isVariableDeclarationList(node)) value = node.getText(source).match(/^(?:var|let|const)\b/)?.[0] ?? '';
    else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) value = node.operator;
    const children = [];
    ts.forEachChild(node, child => { children.push(child); });
    hash.update(JSON.stringify([node.kind, value, children.length]) + '\n');
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], parent: node });
  }
  return hash.digest('hex');
}
const check = (a, b) => fingerprint(a, 'self-a.js') === fingerprint(b, 'self-b.js');
const selfCheck = {
  acceptsFormatting: check('const n=1; (n + 2);', 'const n = 1\n n + 2\n'),
  rejectsSemanticChange: !check('const n=1;', 'const n=2;'),
  distinguishesDeclarationKind: !check('let n=1;', 'const n=1;'),
  distinguishesOptionalChainBoundary: !check('(a?.b).c;', 'a?.b.c;'),
  distinguishesDirective: !check('("use strict");', '"use strict";'),
  distinguishesPrefixOperator: !check('!a;', '~a;'),
  distinguishesPostfixOperator: !check('i++;', 'i--;'),
};
if (Object.values(selfCheck).some(result => !result)) throw new Error('Fingerprint self-check failed');
const original = resolve(evidence, 'original');
const formatted = resolve(evidence, 'formatted');
const names = (await files(original)).map(path => relative(original, path)).sort();
const formattedNames = (await files(formatted)).map(path => relative(formatted, path)).sort();
if (JSON.stringify(names) !== JSON.stringify(formattedNames)) throw new Error('Original/formatted JS file sets differ');
const results = [];
for (const name of names) {
  const [a, b] = await Promise.all([readFile(resolve(original, name), 'utf8'), readFile(resolve(formatted, name), 'utf8')]);
  const originalFingerprint = fingerprint(a, name);
  const formattedFingerprint = fingerprint(b, name);
  results.push({ path: name, originalFingerprint, formattedFingerprint, match: originalFingerprint === formattedFingerprint });
}
const report = { typescript: ts.version, method: 'AST fingerprint; not runtime equivalence', selfCheck, files: results };
await writeFile(resolve(evidence, 'audit/format-equivalence.json'), JSON.stringify(report, null, 2) + '\n');
const mismatches = results.filter(result => !result.match);
console.log(`${results.length} files compared; ${mismatches.length} structural mismatches; self-checks passed.`);
if (mismatches.length) { console.error(mismatches.map(result => result.path).join('\n')); process.exitCode = 1; }
