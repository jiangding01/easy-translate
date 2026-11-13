import { useEffect, useRef, useState } from 'react';
import { SettingsFields } from '@/components/SettingsFields';
import type { ConfigChange } from '@/lib/config/types';
import { useConfig } from '@/lib/config/use-config';
import { describeError } from '@/lib/error-messages';
import { useTheme } from '@/styles/theme';
import styles from '@/styles/ui.module.css';

const SAVED_VISIBLE_MS = 2000;

type Feedback = { kind: 'saved' } | { kind: 'error'; text: string };

export function App() {
  const { state, patch } = useConfig();
  const [feedback, setFeedback] = useState<Feedback>();
  const latestPatch = useRef(0);
  useTheme(state.status === 'ready' ? state.snapshot.data.ui.theme : undefined);

  useEffect(() => {
    if (feedback?.kind !== 'saved') return;
    const timer = setTimeout(() => setFeedback(undefined), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Save on select. No rollback logic: the control always shows the storage
  // snapshot, so a failed patch simply leaves the old value in place.
  async function change(next: ConfigChange) {
    const sequence = ++latestPatch.current;
    const result = await patch([next]);
    // Only the newest patch may set feedback; an older, slower result is stale.
    if (sequence !== latestPatch.current) return;
    setFeedback(
      result.ok
        ? { kind: 'saved' }
        : { kind: 'error', text: describeError(result.error, '保存失败，请重试。') },
    );
  }

  return (
    <main className={styles.options}>
      <header className={styles.header}>
        <img src="/icon/48.png" alt="" width="32" height="32" />
        <span lang="en">Easy Translate</span>
        <span className={styles.badge}>开发版</span>
      </header>
      <h1 className={styles.pageTitle}>翻译设置</h1>
      <p className={styles.muted}>设置保存在当前浏览器中，修改后立即生效。</p>
      {state.status === 'ready' && (
        <SettingsFields value={state.snapshot.data} onChange={(next) => void change(next)} />
      )}
      <p
        className={feedback?.kind === 'error' ? styles.error : styles.status}
        role="status"
        aria-live="polite"
      >
        {state.status === 'loading' && '正在加载设置…'}
        {state.status === 'error' && describeError(state.error, '读取设置失败，请刷新后重试。')}
        {state.status === 'ready' && feedback?.kind === 'saved' && '已保存'}
        {state.status === 'ready' && feedback?.kind === 'error' && feedback.text}
      </p>
    </main>
  );
}
