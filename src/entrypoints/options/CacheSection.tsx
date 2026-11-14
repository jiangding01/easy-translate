import { useEffect, useState } from 'react';
import type { CacheStatsInfo } from '@/lib/messaging/protocol';
import { admin } from './hooks';
import { useNotice } from './notice';
import styles from './options.module.css';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
      notice.failed(result.error, '清空失败，请重试。');
      return;
    }
    setStats({ count: 0, totalBytes: 0 });
    notice.saved('已清空缓存');
  }

  let summary = '正在统计…';
  if (stats) {
    summary =
      stats.count === 0
        ? '暂无缓存 · 译文保留 7 天'
        : `${stats.count.toLocaleString('zh-CN')} 段译文 · ${formatBytes(stats.totalBytes)} · 保留 7 天`;
  }

  return (
    <section aria-labelledby="cache-title" className={styles.cache}>
      <div>
        <h2 id="cache-title" className={styles.sectionTitle}>
          翻译缓存
        </h2>
        <p className={styles.sectionHint}>{summary}</p>
      </div>
      {confirming ? (
        <div className={`${styles.appear} ${styles.inline}`}>
          <span className={styles.hint}>清空后，翻译过的网页需要重新请求</span>
          <button
            type="button"
            className={styles.ghostSmall}
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className={styles.danger}
            onClick={() => void clear()}
            disabled={busy}
          >
            清空
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.ghostSmall}
          onClick={() => setConfirming(true)}
          disabled={stats?.count === 0}
        >
          清空
        </button>
      )}
    </section>
  );
}
