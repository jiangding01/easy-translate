import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { useConfig } from '@/lib/config/use-config';
import { describeError } from '@/lib/error-messages';
import { useTheme } from '@/styles/theme';
import { GeneralPage } from './GeneralPage';
import { NoticeLine, NoticeProvider, useNoticeState } from './notice';
import styles from './options.module.css';
import { ServicesPage } from './ServicesPage';

type Page = 'general' | 'services';

const PAGES: { id: Page; title: string; sub: string }[] = [
  { id: 'general', title: '通用', sub: '语言、外观与译文样式，改动会立即生效。' },
  {
    id: 'services',
    title: '翻译服务',
    sub: 'Google 免费可用；AI 引擎和自定义服务需要你自己的密钥。',
  },
];

function pageFromHash(): Page {
  return location.hash === '#general' ? 'general' : 'services';
}

export function App() {
  const { state } = useConfig();
  const { api, notice } = useNoticeState();
  const [page, setPage] = useState<Page>(pageFromHash);
  useTheme(state.status === 'ready' ? state.snapshot.data.ui.theme : undefined);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const index = PAGES.findIndex((item) => item.id === page);
  const current = PAGES[index] ?? PAGES[1];

  return (
    <NoticeProvider api={api}>
      <div className={styles.shell}>
        <nav aria-label="设置分区" className={styles.nav}>
          <div className={styles.brand}>
            <span aria-hidden="true" className={styles.brandDot} />
            <span lang="en">Easy Translate</span>
          </div>
          <div className={styles.navList} style={{ '--index': index } as React.CSSProperties}>
            <span aria-hidden="true" className={styles.navThumb} />
            {PAGES.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={styles.navItem}
                aria-current={item.id === page ? 'page' : undefined}
              >
                {item.id === 'general' ? <GearIcon /> : <TranslateIcon />}
                {item.title}
              </a>
            ))}
          </div>
          <div className={styles.navFooter}>
            <span>v{browser.runtime.getManifest().version}</span>
          </div>
        </nav>

        <main className={styles.main}>
          <div className={styles.column}>
            <header className={styles.pageHeader}>
              <div>
                <h1 className={styles.pageTitle}>{current?.title}</h1>
                <p className={styles.pageSub}>{current?.sub}</p>
              </div>
              <NoticeLine notice={notice} />
            </header>

            {state.status === 'loading' && <p className={styles.pageSub}>正在加载设置…</p>}
            {state.status === 'error' && (
              <p className={styles.fieldError} role="alert">
                {describeError(state.error, '读取设置失败，请刷新后重试。')}
              </p>
            )}
            {state.status === 'ready' &&
              (page === 'general' ? (
                <GeneralPage config={state.snapshot.data} />
              ) : (
                <ServicesPage config={state.snapshot.data} />
              ))}
          </div>
        </main>
      </div>
    </NoticeProvider>
  );
}

function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

function TranslateIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M2 3.5h6M5 2v1.5M3.2 3.5c.6 2.4 2.2 4.2 4.3 5.2M6.8 3.5c-.5 2.2-2 4.2-4.3 5.4" />
      <path d="M8.5 14l2.8-6.5L14 14M9.4 12h3.8" />
    </svg>
  );
}
