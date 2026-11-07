import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const [source, startText, endText, output] = process.argv.slice(2);
const start = Number(startText), end = Number(endText);
if (!source || !output || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
  throw new Error('Usage: node extract.mjs <formatted-relative-file> <start-LF-line> <end-LF-line> <extract-relative-output.js>');
}
const evidence = resolve(import.meta.dirname, '../../evidence/legacy');
const path = resolve(evidence, 'formatted', source);
const text = await readFile(path, 'utf8');
const lines = text.split('\n');
if (end > lines.length) throw new Error('Excerpt outside source');
const code = lines.slice(start - 1, end).join('\n') + '\n';
const target = resolve(evidence, 'extracts', output);
if (!target.startsWith(resolve(evidence, 'extracts') + '/')) throw new Error('Output must stay in extracts');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, code);
await writeFile(target + '.source.json', JSON.stringify({
  source: `formatted/${source}`, startLine: start, endLine: end, lineConvention: 'LF only',
  formattedSha256: createHash('sha256').update(text).digest('hex'),
  excerptSha256: createHash('sha256').update(code).digest('hex'),
  warning: 'Exact formatted-source excerpt; may depend on enclosing lexical scope; not standalone implementation.',
}, null, 2) + '\n');
console.log(`${output}: ${source}:${start}-${end}`);
