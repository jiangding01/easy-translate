import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { useConfig } from '@/lib/config/use-config';
import { describeError } from '@/lib/error-messages';
import { languageName } from '@/lib/languages';
import { GET_BACKGROUND_STATUS, inspectActivePage, type PageInfo } from '@/lib/messages';
import styles from '@/styles/ui.module.css';

export function App() {
  const { state } = useConfig();
  const [page, setPage] = useState<PageInfo>();
  const [status, setStatus] = useState('正在连接扩展…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    browser.runtime
      .sendMessage({ type: GET_BACKGROUND_STATUS })
      .then(() => setStatus('扩展已就绪，翻译引擎尚未接入。'))
      .catch(() => setStatus('加载失败，请重新加载扩展后重试。'));
  }, []);

  async function inspect() {
    setBusy(true);
    setPage(undefined);
    setStatus('正在检查页面…');
    try {
      setPage(await inspectActivePage());
      setStatus('页面通信正常，可以继续接入翻译引擎。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '检查失败，请重试。');
    } finally {
      setBusy(false);
    }
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
          页面语言：{page.language}
        </p>
      )}
      <p className={styles.status} role="status">
        {status}
      </p>
      <footer className={styles.footer}>
        <span>v{browser.runtime.getManifest().version}</span>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => {
            void browser.runtime
              .openOptionsPage()
              .catch(() => setStatus('无法打开设置页，请重试。'));
          }}
        >
          翻译设置 →
        </button>
      </footer>
    </main>
  );
}
