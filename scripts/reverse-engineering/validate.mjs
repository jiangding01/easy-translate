import assert from 'node:assert/strict';
import { access, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const evidence = resolve(root, 'evidence/legacy');
const reportPath = resolve(evidence, 'validation-report.json');
try {
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = new Map();
const source = async path => {
  if (!sources.has(path)) sources.set(path, await readFile(resolve(evidence, path), 'utf8'));
  return sources.get(path);
};
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async item => item.isDirectory()
    ? walk(resolve(dir, item.name)) : [resolve(dir, item.name)]))).flat();
}
const inventory = await json(resolve(evidence, 'inventory.json'));
let originalFiles = 0, formattedFiles = 0, excerpts = 0, links = 0, lineAnchors = 0;
for (const item of inventory.files) {
  assert.equal(sha(await readFile(resolve(evidence, 'original', item.path))), item.sha256, `Original mismatch: ${item.path}`);
  originalFiles++;
  if (item.formatted) {
    assert.equal(sha(await readFile(resolve(evidence, item.formatted))), item.formattedSha256, `Formatted mismatch: ${item.path}`);
    assert.equal(item.parseDiagnostics.length, 0, `Parse diagnostics: ${item.path}`);
    formattedFiles++;
  }
}
assert.equal((await walk(resolve(evidence, 'original'))).length, originalFiles, 'Uninventoried original files');
const page = await json(resolve(evidence, 'extracts/page/index.json'));
for (const entry of page.declarations) {
  const text = await source(entry.source);
  const code = text.slice(entry.startOffset, entry.endOffset);
  assert.equal(sha(code), entry.sha256, `Page excerpt source mismatch: ${entry.name}`);
  assert.equal(await readFile(resolve(evidence, 'extracts/page', entry.file), 'utf8'), code + '\n');
  assert.equal(text.slice(0, entry.startOffset).split('\n').length, entry.startLine);
  assert.equal(text.slice(0, entry.endOffset).split('\n').length, entry.endLine);
  excerpts++;
}
const providerIndex = await json(resolve(evidence, 'extracts/providers/index.json'));
for (const entry of providerIndex) {
  const lines = (await source(entry.source)).split('\n');
  const saved = await readFile(resolve(evidence, 'extracts/providers', entry.file), 'utf8');
  for (const [start, end] of entry.ranges) {
    assert.ok(start > 0 && end <= lines.length && end >= start);
    assert.ok(saved.includes(lines.slice(start - 1, end).join('\n')), `Provider excerpt mismatch: ${entry.file}:${start}`);
    excerpts++;
  }
  const expected = entry.ranges.map(([start, end]) =>
    `// SOURCE ${entry.source}, LF lines ${start}-${end}; copied, not executable standalone.\n\n` +
    lines.slice(start - 1, end).join('\n') + '\n').join('\n');
  const normalizedHeaderSpacing = saved.replace(/^(\/\/ SOURCE [^\n]+copied, not executable standalone\.)\n\n?/gm, '$1\n\n');
  assert.equal(normalizedHeaderSpacing, expected, `Unexpected content in provider excerpt: ${entry.file}`);
}
const videoIndex = await json(resolve(evidence, 'extracts/video/source-index.json'));
const videoParts = [];
for (const entry of videoIndex) {
  const text = await source(`formatted/${entry.path}`);
  assert.equal(text.slice(0, entry.start).split('\n').length, entry.startLine);
  assert.equal(text.slice(0, entry.end).split('\n').length, entry.endLine);
  videoParts.push(text.slice(entry.start, entry.end));
  excerpts++;
}
assert.equal(await readFile(resolve(evidence, 'extracts/video/selected-declarations.js'), 'utf8'), videoParts.join('\n\n') + '\n');
for (const path of (await walk(resolve(evidence, 'extracts/platform'))).filter(p => p.endsWith('.source.json'))) {
  const entry = await json(path);
  const text = await source(entry.source);
  assert.equal(sha(text), entry.formattedSha256);
  const code = text.split('\n').slice(entry.startLine - 1, entry.endLine).join('\n') + '\n';
  assert.equal(sha(code), entry.excerptSha256);
  assert.equal(await readFile(path.slice(0, -'.source.json'.length), 'utf8'), code);
  excerpts++;
}
const coverage = await json(resolve(evidence, 'artifact-coverage.json'));
assert.equal(coverage.files.length, originalFiles);
for (const item of inventory.files) {
  const entry = coverage.files.find(x => x.path === item.path);
  assert.ok(entry?.documents.length, `Unmapped artifact: ${item.path}`);
  for (const doc of entry.documents) await access(resolve(root, doc));
}
const entryText = await readFile(resolve(root, 'docs/README.md'), 'utf8');
const modulePaths = (await walk(resolve(root, 'docs/modules'))).filter(path => path.endsWith('.md'));
for (const path of modulePaths) {
  assert.ok(entryText.includes(`modules/${relative(resolve(root, 'docs/modules'), path)}`), `Module missing from entry index: ${path}`);
}
const auditMarkdown = (await walk(resolve(evidence, 'audit'))).filter(path => path.endsWith('.md') && !path.includes('/baseline/'));
const comparisonDir = resolve(evidence, 'cross-validation');
const comparisonMarkdown = (await readdir(comparisonDir)).filter(name => name.endsWith('.md')).map(name => resolve(comparisonDir, name));
const markdown = [resolve(root, 'README.md'), ...(await walk(resolve(root, 'docs'))).filter(p => p.endsWith('.md')), resolve(evidence, 'README.md'), ...auditMarkdown, ...comparisonMarkdown];
for (const path of markdown) {
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const url = match[1];
    if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('#')) continue;
    const [target, anchor] = url.split('#');
    const absolute = resolve(dirname(path), decodeURIComponent(target));
    assert.ok(absolute.startsWith(root + '/'), `Link leaves project: ${path}: ${url}`);
    if (absolute !== reportPath) await access(absolute).catch(() => { throw new Error(`Missing link in ${relative(root, path)}: ${url}`); });
    links++;
    if (anchor && /^L\d+/.test(anchor)) {
      const line = Number(anchor.match(/^L(\d+)/)[1]);
      assert.ok(line > 0 && line <= (await readFile(absolute, 'utf8')).split('\n').length, `Invalid LF anchor: ${url}`);
      lineAnchors++;
    }
  }
}
const probes = await json(resolve(evidence, 'extracts/video/probe-results.json'));
assert.ok(probes.results.length >= 14 && probes.results.every(x => x.passed));
const formatCheck = await json(resolve(evidence, 'audit/format-equivalence.json'));
assert.equal(formatCheck.files.length, formattedFiles);
assert.equal(new Set(formatCheck.files.map(x => x.path)).size, formattedFiles);
assert.ok(formatCheck.files.every(x => x.match && inventory.files.some(f => f.path === x.path && f.formatted)));
assert.ok(Object.values(formatCheck.selfCheck).every(Boolean));
const videoAudit = await json(resolve(evidence, 'audit/video/adversarial-results.json'));
assert.equal(videoAudit.cases.length, 2);
assert.equal(videoAudit.cases[0].selected, 'manual');
assert.equal(new URL(videoAudit.cases[1].resultUrl).searchParams.has('pot'), false);
const platformAudit = await json(resolve(evidence, 'audit/platform/probe-results.json'));
assert.equal(platformAudit.assertions, 'passed');
assert.equal(platformAudit.source.fileSha256, sha(await readFile(resolve(evidence, 'formatted/background.js'))));
assert.equal(platformAudit.cases.checkAndDisable.setEnabledCalls.length, 0);
assert.equal(platformAudit.cases.disableWithRejectedSetEnabled.returned.success, true);
assert.equal(platformAudit.cases.disableWithRejectedSetEnabled.extensionEnabled, true);
assert.equal(platformAudit.cases.restoreWithRejectedSetEnabled.returned, true);
assert.equal(platformAudit.cases.restoreWithRejectedSetEnabled.extensionEnabled, false);
assert.equal(platformAudit.cases.restoreWithRejectedSetEnabled.managementKeyPresent, false);
const comparisonManifest = await json(resolve(comparisonDir, 'deepseek-manifest.json'));
for (const file of comparisonManifest.files) {
  assert.equal(sha(await readFile(resolve(comparisonDir, 'deepseek', file.path))), file.sha256, `DeepSeek snapshot changed: ${file.path}`);
}
const i18nProbe = await json(resolve(comparisonDir, 'i18n-probe-results.json'));
assert.equal(i18nProbe.results.length, 6);
assert.ok(i18nProbe.results.every(item => item.passed));
assert.equal(i18nProbe.provenance.sha256, sha(await readFile(resolve(root, i18nProbe.provenance.path))));
const archives = await json(resolve(evidence, 'rea/archive-index.json'));
for (const archive of archives.files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(resolve(evidence, 'rea', archive.path))) hash.update(chunk);
  assert.equal(hash.digest('hex'), archive.sha256, `REA archive changed: ${archive.path}`);
}
const report = {
  status: 'passed', scope: 'Documentation, snapshot and extracted-code integrity; does not prove live legacy extension behavior',
  originalFiles, formattedFiles, syntaxParseErrors: 0, verifiedExcerptRanges: excerpts,
  mappedArtifacts: coverage.files.length, checkedMarkdownFiles: markdown.length, checkedLocalLinks: links,
  indexedModuleDocuments: modulePaths.length,
  validLFLineAnchors: lineAnchors, offlineVideoProbes: probes.results.length,
  comparedOriginalFormattedSyntaxTrees: formatCheck.files.length,
  additionalOfflineAuditCases: videoAudit.cases.length + Object.keys(platformAudit.cases).length,
  crossValidationSnapshotFiles: comparisonManifest.files.length,
  offlineI18nCases: i18nProbe.results.length,
  verifiedREAArchives: archives.files.length,
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(reportPath, JSON.stringify({ status: 'failed', message: error instanceof Error ? error.message : String(error) }, null, 2) + '\n');
  console.error(error);
  process.exitCode = 1;
}
