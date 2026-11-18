import { useEffect, useRef, useState } from 'react';
import { i18n } from '#i18n';
import { describeError } from '@/lib/error-messages';
import type { AppError, Result } from '@/lib/errors';
import type { ProviderTestResult } from '@/lib/messaging/protocol';
import styles from './options.module.css';

type TestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: ProviderTestResult }
  | { status: 'fail'; error: AppError };

interface Props {
  run: () => Promise<Result<ProviderTestResult>>;
  /** Why the test cannot run yet; the button is disabled while set. */
  blocked?: string;
  /** Runs once on mount (a freshly added provider). */
  autoRun?: boolean;
  /** Identity of what is tested; when it changes, an old result no longer applies. */
  resetKey: string;
}

/**
 * The connection test in isle material: "Hello, world." → the live translation,
 * which fades in the way page translations do, followed by the latency.
 */
export function TestStrip({ run, blocked, autoRun, resetKey }: Props) {
  const [state, setState] = useState<TestState>({ status: 'idle' });
  const [detail, setDetail] = useState(false);
  const sequence = useRef(0);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  async function start() {
    const current = ++sequence.current;
    setDetail(false);
    setState({ status: 'loading' });
    const result = await run();
    if (!live.current || current !== sequence.current) return;
    setState(
      result.ok ? { status: 'ok', result: result.data } : { status: 'fail', error: result.error },
    );
  }

  // A result (or a reply still on its way) for other fields is dropped.
  const testedKey = useRef(resetKey);
  useEffect(() => {
    if (testedKey.current === resetKey) return;
    testedKey.current = resetKey;
    sequence.current += 1;
    setDetail(false);
    setState({ status: 'idle' });
  }, [resetKey]);

  const autoRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a one-shot run; `start` reads the latest props itself
  useEffect(() => {
    if (!autoRun || autoRan.current || blocked) return;
    autoRan.current = true;
    void start();
  }, [autoRun, blocked]);

  const label =
    state.status === 'loading'
      ? i18n.t('options.test.running')
      : state.status === 'idle'
        ? i18n.t('options.test.run')
        : i18n.t('options.test.again');
  return (
    <>
      <div className={styles.strip}>
        <span lang="en" className={styles.stripSource}>
          Hello, world.
        </span>
        <svg
          aria-hidden="true"
          className={styles.stripArrow}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        >
          <path d="M2.5 7h9M8.5 4l3 3-3 3" />
        </svg>
        <span className={styles.stripResult} role="status" aria-live="polite">
          {state.status === 'idle' && (
            <span className={styles.stripDim}>{blocked ?? i18n.t('options.test.prompt')}</span>
          )}
          {state.status === 'loading' && (
            <span className={styles.stripDim}>{i18n.t('options.test.requesting')}</span>
          )}
          {state.status === 'ok' && (
            <>
              <span className={styles.appear}>{state.result.text}</span>
              <span className={`${styles.appear} ${styles.stripLatency}`}>
                <span aria-hidden="true" className={styles.okDot} />
                {state.result.latencyMs} ms
              </span>
            </>
          )}
          {state.status === 'fail' && (
            <span className={`${styles.appear} ${styles.stripFail}`}>
              {i18n.t('options.test.failed')}
            </span>
          )}
        </span>
        <button
          type="button"
          className={styles.testButton}
          onClick={() => void start()}
          disabled={blocked !== undefined || state.status === 'loading'}
        >
          {label}
        </button>
        {state.status === 'loading' && (
          <span aria-hidden="true" className={styles.stripTrack}>
            <span className={styles.sweep} />
          </span>
        )}
      </div>
      {state.status === 'fail' && (
        <p className={`${styles.appear} ${styles.failText}`}>
          {describeError(state.error, i18n.t('errors.action.connectFailed'))}
          <button
            type="button"
            className={styles.textButton}
            onClick={() => setDetail(!detail)}
            aria-expanded={detail}
          >
            {detail ? i18n.t('options.test.collapse') : i18n.t('options.test.details')}
          </button>
          {detail && <code className={styles.failCode}>{state.error.code}</code>}
        </p>
      )}
    </>
  );
}
