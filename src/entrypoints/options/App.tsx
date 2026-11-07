import { useEffect, useState, type FormEvent } from 'react';
import { SettingsFields } from '@/components/SettingsFields';
import { defaultSettings, getSettings, saveSettings } from '@/lib/settings';
import styles from '@/styles/ui.module.css';

export function App() {
  const [settings, setSettings] = useState(defaultSettings);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('正在加载设置…');

  useEffect(() => {
    getSettings().then((value) => {
      setSettings(value);
      setLoaded(true);
      setStatus('设置保存在当前浏览器中。');
    }).catch(() => setStatus('读取设置失败，请刷新后重试。'));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus('正在保存…');
    try {
      await saveSettings(settings);
      setStatus('设置已保存。重新打开弹窗即可查看。');
    } catch {
      setStatus('保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.options}>
      <header className={styles.header}>
        <img src="/icon/48.png" alt="" width="32" height="32" />
        <span lang="en">Easy Translate</span>
        <span className={styles.badge}>开发版</span>
      </header>
      <h1 className={styles.pageTitle}>翻译设置</h1>
      <p className={styles.muted}>先选择阅读偏好。接入翻译引擎后，这些设置将用于网页翻译。</p>
      <form onSubmit={(event) => void submit(event)}>
        <SettingsFields value={settings} onChange={(value) => {
          setSettings(value);
          setStatus('有未保存的更改。');
        }} disabled={!loaded || saving} />
        <button className={styles.primary} disabled={!loaded || saving} type="submit">
          {saving ? '保存中…' : '保存设置'}
        </button>
        <p className={styles.status} role="status">{status}</p>
      </form>
    </main>
  );
}
