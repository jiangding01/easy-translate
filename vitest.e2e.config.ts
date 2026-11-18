import { defineConfig } from 'vitest/config';
import type { Reporter, TestCase } from 'vitest/node';

// Smoke e2e (docs/plans/e2e-smoke.md): a real browser per file, so files run one at a time.
// `npm test` does not match these files (its include is src/** and scripts/**).

/** Lists every test that needed a retry, passed or not, so flakiness is never silent. */
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
        const tries = testCase.diagnostic()?.retryCount;
        console.log(`  ${testCase.result().state} after ${tries} retry: ${testCase.fullName}`);
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
