import { defineConfig } from 'vitest/config';
import type { Reporter, TestCase } from 'vitest/node';

// Smoke e2e (docs/plans/e2e-smoke.md): a real browser per file, so files run one at a time.
// `npm test` does not match these files (its include is src/** and scripts/**).

/** GitHub Actions workflow commands: a message keeps its newlines and percent signs. */
const escapeCommand = (text: string) =>
  text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * Lists every test that needed a retry, passed or not, so flakiness is never silent: with the
 * errors of its failed attempts (the default reporter drops them once a retry passes) and, on
 * CI, a warning annotation on the run.
 */
function retriedReporter(): Reporter {
  const retried: TestCase[] = [];
  return {
    onTestCaseResult(testCase) {
      if (testCase.diagnostic()?.retryCount) retried.push(testCase);
    },
    onTestRunEnd() {
      if (retried.length === 0) return;
      console.log('\nRetried e2e tests:');
      for (const testCase of retried) {
        const retries = testCase.diagnostic()?.retryCount ?? 0;
        const name = `${testCase.module.relativeModuleId} > ${testCase.fullName}`;
        const shown = name.replace(/\r?\n/g, '\\n');
        const summary = `${name} ${testCase.result().state} after ${retries} ${retries === 1 ? 'retry' : 'retries'}`;
        if (process.env.CI) console.log(`::warning title=e2e retried::${escapeCommand(summary)}`);
        console.log(`  ${summary.replace(name, shown)}`);
        for (const [index, attempt] of testCase.attempts().entries()) {
          if (attempt.state !== 'failed') continue;
          console.log(`    attempt ${index + 1} failed:`);
          for (const error of attempt.errors ?? []) {
            const text = error.stack || `${error.name ?? 'Error'}: ${error.message}`;
            console.log(text.replace(/^/gm, '      '));
          }
        }
      }
    },
  };
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    // Above launch()'s own worst case (about 35 s of waits): a launch that is still running
    // when its test or hook times out would start a browser nothing closes.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 1,
    reporters: ['default', retriedReporter()],
  },
});
