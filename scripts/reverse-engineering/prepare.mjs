import { cp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(process.argv[2] ?? '/Users/jiangding/yezi');
const evidence = resolve(root, 'evidence/legacy');
const snapshot = resolve(evidence, 'original');
await mkdir(evidence, { recursive: true });
try {
  await stat(snapshot);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await cp(source, snapshot, { recursive: true, errorOnExist: true, force: false });
}

async function walk(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) result.push(...await walk(path));
    else if (item.isFile()) result.push(path);
    else throw new Error(`Unsupported snapshot entry: ${path}`);
  }
  return result;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });
const inventory = [];
const symbols = [];
const strings = [];
for (const path of await walk(snapshot)) {
  const name = relative(snapshot, path);
  const bytes = await readFile(path);
  const entry = { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  if (name.endsWith('.js')) {
    const sourceFile = ts.createSourceFile(name, bytes.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const text = printer.printFile(sourceFile);
    const target = resolve(evidence, 'formatted', name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    entry.formatted = relative(evidence, target);
    entry.formattedSha256 = sha256(text);
    entry.parseDiagnostics = sourceFile.parseDiagnostics.map(d => ({
      start: d.start, message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }));
    const formatted = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      const start = node.getStart(formatted);
      const location = formatted.getLineAndCharacterOfPosition(start);
      if (ts.isStringLiteralLike(node) && node.text.length >= 3) {
        strings.push({ path: name, line: location.line + 1, value: node.text });
      }
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) {
        symbols.push({ path: name, name: node.name?.getText(formatted) ?? '(anonymous)', kind: ts.SyntaxKind[node.kind],
          startLine: location.line + 1,
          endLine: formatted.getLineAndCharacterOfPosition(node.getEnd()).line + 1 });
      }
      ts.forEachChild(node, visit);
    }
    visit(formatted);
  }
  inventory.push(entry);
}
await writeFile(resolve(evidence, 'inventory.json'), JSON.stringify({
  source, snapshot: 'original', version: JSON.parse(await readFile(resolve(snapshot, 'manifest.json'), 'utf8')).version,
  method: `SHA-256 raw bytes; JS formatted using TypeScript ${ts.version} createPrinter, never executed`,
  files: inventory,
}, null, 2) + '\n');
await writeFile(resolve(evidence, 'symbols.json'), JSON.stringify(symbols, null, 2) + '\n');
await writeFile(resolve(evidence, 'strings.json'), JSON.stringify(strings, null, 2) + '\n');
console.log(`Preserved ${inventory.length} files; formatted ${inventory.filter(x => x.formatted).length} JS files; ${symbols.length} symbols; ${strings.length} string occurrences.`);
await import('./catalog.mjs');
