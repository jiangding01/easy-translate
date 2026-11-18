// Runtime dependency audit for CI: `npm audit --omit=dev`, failing on any high or critical
// advisory except those listed in scripts/audit-allowlist.json. The list names advisories by
// ID (a new advisory for the same package still fails), each with a reason and an expiry.
// It also fails when an entry has expired, when an entry no longer matches anything the audit
// reports (upstream fixed it: remove the entry), and when the audit itself cannot be read.
//
// Usage: node scripts/check-audit.mjs
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const ALLOWLIST_FILE = resolve(ROOT, 'scripts/audit-allowlist.json');
const BLOCKING = new Set(['high', 'critical']);
const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Allowlist entries, or a list of problems when the file is malformed. */
export function parseAllowlist(json) {
  const problems = [];
  const entries = Array.isArray(json?.advisories) ? json.advisories : undefined;
  if (!entries)
    return { entries: [], problems: ['audit-allowlist.json: "advisories" must be an array'] };
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const where = `audit-allowlist.json advisories[${index}]`;
    if (typeof entry?.id !== 'string' || !GHSA.test(entry.id)) {
      problems.push(`${where}: "id" must be a GHSA ID`);
      continue;
    }
    if (seen.has(entry.id)) problems.push(`${where}: ${entry.id} is listed twice`);
    seen.add(entry.id);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push(`${where}: ${entry.id} needs a "reason"`);
    }
    const expires = entry.expires;
    if (
      typeof expires !== 'string' ||
      !DATE.test(expires) ||
      new Date(`${expires}T00:00:00Z`).toISOString().slice(0, 10) !== expires
    ) {
      problems.push(`${where}: ${entry.id} needs "expires" as YYYY-MM-DD`);
    }
  }
  return { entries, problems };
}

/** Every advisory in an `npm audit --json` (v2) report: `{ id, package, severity, url }`. */
export function advisoriesOf(report) {
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      // A string `via` is a dependency that carries another package's advisory.
      if (typeof via !== 'object' || via === null) continue;
      const url = typeof via.url === 'string' ? via.url : '';
      const id = url.match(/GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/)?.[0] ?? `npm:${via.source}`;
      found.set(id, { id, package: via.name, severity: via.severity, url });
    }
  }
  return [...found.values()];
}

/**
 * What fails the audit, given the parsed report, the allowlist entries and today's date
 * (YYYY-MM-DD, UTC). Empty when it passes.
 */
export function auditProblems(report, entries, today) {
  if (report === null || typeof report !== 'object') return ['npm audit printed no JSON report'];
  if (report.error) {
    return [`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`];
  }
  if (report.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object') {
    return ['npm audit report has an unknown shape (expected auditReportVersion 2)'];
  }
  const problems = [];
  const advisories = advisoriesOf(report);
  const allowed = new Map(entries.map((entry) => [entry.id, entry]));
  for (const advisory of advisories) {
    if (!BLOCKING.has(advisory.severity)) continue;
    const entry = allowed.get(advisory.id);
    const label = `${advisory.severity} ${advisory.id} in ${advisory.package} (${advisory.url})`;
    if (!entry) problems.push(`Not allowed: ${label}`);
    else if (today > entry.expires) {
      problems.push(
        `Allowlist entry expired on ${entry.expires}: ${label}. Re-check it, then renew or fix.`,
      );
    }
  }
  const reported = new Set(advisories.map((advisory) => advisory.id));
  for (const entry of entries) {
    if (!reported.has(entry.id)) {
      problems.push(
        `Allowlist entry ${entry.id} no longer matches the audit: remove it from audit-allowlist.json`,
      );
    }
  }
  return problems;
}

async function main() {
  const { entries, problems } = parseAllowlist(JSON.parse(await readFile(ALLOWLIST_FILE, 'utf8')));
  // npm exits non-zero whenever it finds anything: read the report, not the exit code.
  const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    // No output at all (npm did not start) is not "no advisories": parse '' so it fails.
    report = JSON.parse(run.stdout ?? '');
  } catch {
    const detail = run.error?.message ?? run.stderr?.trim() ?? '';
    problems.push(`npm audit output is not JSON (exit ${run.status}): ${detail}`);
  }
  if (report !== undefined) {
    // A parsed `null` or non-object fails here too (auditProblems fails closed).
    problems.push(...auditProblems(report, entries, new Date().toISOString().slice(0, 10)));
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
    return;
  }
  for (const entry of entries) {
    console.log(`Allowed until ${entry.expires}: ${entry.id} (${entry.package ?? 'see reason'})`);
  }
  console.log('Runtime dependency audit passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
