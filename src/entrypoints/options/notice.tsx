import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { describeError } from '@/lib/error-messages';
import type { AppError } from '@/lib/errors';
import styles from './options.module.css';

export type Notice = { kind: 'saved'; text: string } | { kind: 'error'; text: string };

interface NoticeApi {
  saved(text?: string): void;
  failed(error: AppError, fallback?: string): void;
}

const NoticeContext = createContext<NoticeApi>({ saved: () => {}, failed: () => {} });

export const useNotice = () => useContext(NoticeContext);

const SAVED_VISIBLE_MS = 1800;
const ERROR_VISIBLE_MS = 6000;

/** One quiet status line in the page header: "已保存" flashes, errors stay a little longer. */
export function useNoticeState(): {
  api: NoticeApi;
  notice: (Notice & { key: number }) | undefined;
} {
  const [notice, setNotice] = useState<Notice & { key: number }>();
  const show = useCallback((next: Notice) => {
    setNotice((previous) => ({ ...next, key: (previous?.key ?? 0) + 1 }));
  }, []);
  const [api] = useState<NoticeApi>(() => ({
    saved: (text = '已保存') => show({ kind: 'saved', text }),
    failed: (error, fallback = '保存失败，请重试。') =>
      show({ kind: 'error', text: describeError(error, fallback) }),
  }));

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice(undefined),
      notice.kind === 'saved' ? SAVED_VISIBLE_MS : ERROR_VISIBLE_MS,
    );
    return () => clearTimeout(timer);
  }, [notice]);

  return { api, notice };
}

export function NoticeProvider({ api, children }: { api: NoticeApi; children: React.ReactNode }) {
  return <NoticeContext.Provider value={api}>{children}</NoticeContext.Provider>;
}

export function NoticeLine({ notice }: { notice: (Notice & { key: number }) | undefined }) {
  return (
    <p className={styles.notice} role="status" aria-live="polite">
      {notice && (
        <span
          key={notice.key}
          className={notice.kind === 'error' ? styles.noticeError : styles.noticeSaved}
        >
          {notice.kind === 'saved' && (
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2.5 6.2l2.2 2.2 4.8-4.8" />
            </svg>
          )}
          {notice.text}
        </span>
      )}
    </p>
  );
}
