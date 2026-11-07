import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const input = resolve(root, 'evidence/legacy/formatted/content-scripts/host.js');
const output = resolve(root, 'evidence/legacy/extracts/page');
await mkdir(output, { recursive: true });
const bytes = await readFile(input);
const text = bytes.toString('utf8');
const source = ts.createSourceFile('host.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(`Hu M9 cH E9 R9 uY fY dY e2 q9e BS fg a2 qY KY qAe jAe VAe GAe KAe Jfe av tpe tst nst rst S0 ast G9 hf ZEe YEe XEe zEe JY V9e MAe Q9e Uw s4 C0 Est g_ dpe fpe $st Tst ipe g4 ope mst bst hpe Gw y_ pm gpe Lst lv Vst Kst Yst Zst _st Dst p_ hst HY bAe Kq Tct Fct T_ nct rdt ndt Jut Yut qut tRe nRe hdt ldt Nlt wlt vlt KYe Dle YYe nXe jle aXe iXe oXe Hle Qot elt tlt dlt klt llt clt Hfe Yot qot Zot rv Vw Xot e_ Jot UBe HK cpt bhe xhe aft whe nN sft Qft ept D4 Fhe lpt G_ eD cD`.split(' '));
const declarations = [];
const variables = {};
function literal(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isVoidExpression(node)) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(p => {
    if (!ts.isPropertyAssignment(p)) return ['$unresolved', p.getText(source)];
    const key = ts.isIdentifier(p.name) ? p.name.text : p.name.text;
    return [key, literal(p.initializer)];
  }));
  return { $unresolved: node.getText(source) };
}
function visit(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name) && names.has(node.name.text)) {
    const start = node.getStart(source);
    const end = node.getEnd();
    const name = node.name.text;
    const code = text.slice(start, end);
    const entry = { name, kind: ts.SyntaxKind[node.kind], source: 'formatted/content-scripts/host.js',
      startLine: text.slice(0, start).split('\n').length,
      endLine: text.slice(0, end).split('\n').length,
      startOffset: start, endOffset: end,
      file: `${text.slice(0, start).split('\n').length}-${name}.js`, sha256: createHash('sha256').update(code).digest('hex') };
    declarations.push(entry);
    variables[name] = code;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['Ed', 'y9', 'v9', 'c4', 'JL', 'Uot', 'Dfe'].includes(node.name.text) && node.initializer) {
    variables[node.name.text] = literal(node.initializer);
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const file of await readdir(output)) {
  if (file.endsWith('.js')) await unlink(resolve(output, file));
}
for (const entry of declarations) await writeFile(resolve(output, entry.file), variables[entry.name] + '\n');
await writeFile(resolve(output, 'index.json'), JSON.stringify({
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  lineConvention: 'LF-delimited lines; offsets are UTF-16 positions in formatted source',
  method: 'TypeScript AST selection; no target code execution; extracts are exact formatted-source substrings',
  declarations,
}, null, 2) + '\n');
await writeFile(resolve(output, 'site-rules.json'), JSON.stringify({
  metadata: variables.Ed, fallbackRules: variables.y9, fallbackFeatures: variables.v9,
  note: 'Static literal extraction only. Null in excludeMatches represents void 0. Remote rules not fetched.',
}, null, 2) + '\n');
await writeFile(resolve(output, 'share-presets.json'), JSON.stringify({ ratios: variables.c4, themes: variables.JL }, null, 2) + '\n');
console.log(`Extracted ${declarations.length} declarations and static site rules.`);
