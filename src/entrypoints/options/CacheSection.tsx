import { useEffect, useState } from 'react';
import { i18n } from '#i18n';
import type { CacheStatsInfo } from '@/lib/messaging/protocol';
import { uiLocale } from '@/lib/ui-locale';
import { admin } from './hooks';
import { useNotice } from './notice';
import styles from './options.module.css';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The one-line cache summary under the section title; copy follows the UI language. */
export function cacheSummary(stats: CacheStatsInfo): string {
  if (stats.count === 0) return i18n.t('options.cache.empty');
  return i18n.t('options.cache.summary', stats.count, [
    stats.count.toLocaleString(uiLocale()),
    formatBytes(stats.totalBytes),
  ]);
}

export function CacheSection() {
  const notice = useNotice();
  const [stats, setStats] = useState<CacheStatsInfo>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void admin.cacheStats().then((result) => live && result.ok && setStats(result.data));
    return () => {
      live = false;
    };
  }, []);

  async function clear() {
    setBusy(true);
    const result = await admin.clearCache();
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      notice.failed(result.error, i18n.t('errors.action.clearFailed'));
      return;
    }
    setStats({ count: 0, totalBytes: 0 });
    notice.saved(i18n.t('options.cache.cleared'));
  }

  const summary = stats ? cacheSummary(stats) : i18n.t('options.cache.counting');

  return (
    <section aria-labelledby="cache-title" className={styles.cache}>
      <div>
        <h2 id="cache-title" className={styles.sectionTitle}>
          {i18n.t('options.cache.title')}
        </h2>
        <p className={styles.sectionHint}>{summary}</p>
      </div>
      {confirming ? (
        <div className={`${styles.appear} ${styles.inline}`}>
          <span className={styles.hint}>{i18n.t('options.cache.clearHint')}</span>
          <button
            type="button"
            className={styles.ghostSmall}
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            {i18n.t('options.cache.cancel')}
          </button>
          <button
            type="button"
            className={styles.danger}
            onClick={() => void clear()}
            disabled={busy}
          >
            {i18n.t('options.cache.clear')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.ghostSmall}
          onClick={() => setConfirming(true)}
          disabled={stats?.count === 0}
        >
          {i18n.t('options.cache.clear')}
        </button>
      )}
    </section>
  );
}
