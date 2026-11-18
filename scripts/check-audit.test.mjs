import { describe, expect, it } from 'vitest';
import { advisoriesOf, auditProblems, parseAllowlist } from './check-audit.mjs';

const PICOMATCH = 'GHSA-fc5q-39xc-vjpf';
const OTHER = 'GHSA-2222-3333-4444';

function advisory(id, name, severity = 'high') {
  return { source: 1, name, severity, url: `https://github.com/advisories/${id}`, range: '<=1' };
}

/** A v2 report like `npm audit --json`: the advisory on its package, a string via above it. */
function report(...advisories) {
  const vulnerabilities = {};
  for (const item of advisories) {
    vulnerabilities[item.name] ??= { name: item.name, severity: item.severity, via: [] };
    vulnerabilities[item.name].via.push(item);
  }
  vulnerabilities.carrier = {
    name: 'carrier',
    severity: 'high',
    via: advisories.map((a) => a.name),
  };
  return { auditReportVersion: 2, vulnerabilities };
}

const allow = (id, expires = '2026-12-18') => ({ id, reason: 'build only', expires });

describe('auditProblems', () => {
  it('passes an allowed advisory before it expires, and ignores string vias', () => {
    expect(
      auditProblems(report(advisory(PICOMATCH, 'picomatch')), [allow(PICOMATCH)], '2026-11-18'),
    ).toEqual([]);
    expect(
      auditProblems(report(advisory(PICOMATCH, 'picomatch')), [allow(PICOMATCH)], '2026-12-18'),
    ).toEqual([]);
  });

  it('fails any other high or critical advisory, even on an allowed package', () => {
    const problems = auditProblems(
      report(advisory(PICOMATCH, 'picomatch'), advisory(OTHER, 'picomatch', 'critical')),
      [allow(PICOMATCH)],
      '2026-11-18',
    );
    expect(problems).toEqual([
      expect.stringContaining(`Not allowed: critical ${OTHER} in picomatch`),
    ]);
  });

  it('lets moderate and low advisories through, like --audit-level=high', () => {
    expect(auditProblems(report(advisory(OTHER, 'x', 'moderate')), [], '2026-11-18')).toEqual([]);
  });

  it('fails an allowed advisory once its entry has expired', () => {
    const problems = auditProblems(
      report(advisory(PICOMATCH, 'picomatch')),
      [allow(PICOMATCH)],
      '2026-12-19',
    );
    expect(problems).toEqual([expect.stringContaining('expired on 2026-12-18')]);
  });

  it('fails an entry the audit no longer reports', () => {
    const problems = auditProblems(report(), [allow(PICOMATCH)], '2026-11-18');
    expect(problems).toEqual([expect.stringContaining(`${PICOMATCH} no longer matches`)]);
  });

  it('fails closed when the audit itself failed or has an unknown shape', () => {
    expect(
      auditProblems({ error: { code: 'ENOTFOUND', summary: 'registry down' } }, [], '2026-11-18'),
    ).toEqual(['npm audit failed: registry down']);
    expect(auditProblems({ vulnerabilities: {} }, [], '2026-11-18')).toEqual([
      expect.stringContaining('unknown shape'),
    ]);
    expect(auditProblems(null, [], '2026-11-18')).toEqual(['npm audit printed no JSON report']);
  });
});

describe('advisoriesOf', () => {
  it('collects each advisory once, by GHSA ID', () => {
    const item = advisory(PICOMATCH, 'picomatch');
    const value = report(item);
    value.vulnerabilities.fdir = { name: 'fdir', severity: 'high', via: [item] };
    expect(advisoriesOf(value)).toEqual([
      { id: PICOMATCH, package: 'picomatch', severity: 'high', url: item.url },
    ]);
  });
});

describe('parseAllowlist', () => {
  it('accepts the shipped shape', () => {
    expect(parseAllowlist({ advisories: [allow(PICOMATCH)] }).problems).toEqual([]);
  });

  it('rejects a malformed list or entry', () => {
    expect(parseAllowlist({}).problems).toEqual([expect.stringContaining('must be an array')]);
    const { problems } = parseAllowlist({
      advisories: [
        { id: 'picomatch', reason: 'x', expires: '2026-12-18' },
        { id: PICOMATCH, reason: ' ', expires: '2026-12-18' },
        { id: OTHER, reason: 'x', expires: '2026-02-30' },
        allow(OTHER),
      ],
    });
    expect(problems).toEqual([
      expect.stringContaining('must be a GHSA ID'),
      expect.stringContaining('needs a "reason"'),
      expect.stringContaining('needs "expires"'),
      expect.stringContaining('listed twice'),
    ]);
  });
});
