import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { useConfig } from '@/lib/config/use-config';
import { describeError } from '@/lib/error-messages';
import { languageName } from '@/lib/languages';
import { call } from '@/lib/messaging/handle';
import { type PageInfo, sendMessage } from '@/lib/messaging/protocol';
import styles from '@/styles/ui.module.css';
import { inspectActivePage } from './inspect-page';

interface Status {
  text: string;
  error?: boolean;
}

export function App() {
  const { state } = useConfig();
  const [page, setPage] = useState<PageInfo>();
  const [status, setStatus] = useState<Status>({ text: '正在连接扩展…' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call(() => sendMessage('app.getStatus', undefined)).then((result) =>
      setStatus(
        result.ok
          ? { text: '扩展已就绪，翻译引擎尚未接入。' }
          : { text: describeError(result.error), error: true },
      ),
    );
  }, []);

  async function inspect() {
    setBusy(true);
    setPage(undefined);
    setStatus({ text: '正在检查页面…' });
    const result = await inspectActivePage().catch(() => undefined);
    if (result?.ok) {
      setPage(result.data);
      setStatus({ text: '页面通信正常，可以继续接入翻译引擎。' });
    } else {
      setStatus({
        text: result ? describeError(result.error, '检查失败，请重试。') : '检查失败，请重试。',
        error: true,
      });
    }
    setBusy(false);
  }

  return (
    <main className={styles.popup}>
      <header className={styles.header}>
        <img src="/icon/48.png" alt="" width="32" height="32" />
        <h1 lang="en">Easy Translate</h1>
        <span className={styles.badge}>开发版</span>
      </header>
      <p className={styles.muted}>网页翻译，从这里开始。</p>
      <dl className={styles.summary}>
        <div>
          <dt>目标语言</dt>
          <dd>
            {state.status === 'ready' && languageName(state.snapshot.data.language.target)}
            {state.status === 'loading' && '加载中'}
            {state.status === 'error' && describeError(state.error, '读取失败')}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className={styles.primary}
        onClick={() => void inspect()}
        disabled={busy}
      >
        {busy ? '检查中…' : '检查当前页面'}
      </button>
      {page && (
        <p className={styles.pageInfo}>
          {page.title || '未命名页面'}
          <br />
          页面语言：{page.language || '未声明'}
        </p>
      )}
      <p className={status.error ? styles.error : styles.status} role="status">
        {status.text}
      </p>
      <footer className={styles.footer}>
        <span>v{browser.runtime.getManifest().version}</span>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => {
            void browser.runtime
              .openOptionsPage()
              .catch(() => setStatus({ text: '无法打开设置页，请重试。', error: true }));
          }}
        >
          翻译设置 →
        </button>
      </footer>
    </main>
  );
}
