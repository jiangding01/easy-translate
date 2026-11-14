import { type ConfigChange, type ConfigV1, THEMES, type Theme } from '@/lib/config/types';
import { useConfig } from '@/lib/config/use-config';
import { LANGUAGES, type LanguageCode } from '@/lib/languages';
import { useNotice } from './notice';
import styles from './options.module.css';

const THEME_LABELS: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' };

export function GeneralPage({ config }: { config: ConfigV1 }) {
  const { patch } = useConfig();
  const notice = useNotice();

  async function change(next: ConfigChange) {
    const result = await patch([next]);
    if (result.ok) notice.saved();
    else notice.failed(result.error);
  }

  const themeIndex = THEMES.indexOf(config.ui.theme);
  return (
    <section aria-label="通用" className={styles.card}>
      <div className={styles.settingRow}>
        <div className={styles.settingText}>
          <label htmlFor="target-language" className={styles.settingName}>
            目标语言
          </label>
          <span className={styles.settingHint}>网页会被翻译成这种语言</span>
        </div>
        <select
          id="target-language"
          className={styles.select}
          value={config.language.target}
          onChange={(event) =>
            void change({ path: 'language.target', value: event.target.value as LanguageCode })
          }
        >
          {LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingText}>
          <label htmlFor="source-language" className={styles.settingName}>
            源语言
          </label>
          <span className={styles.settingHint}>自动检测适合大多数网页；检测不准时再手动指定</span>
        </div>
        <select
          id="source-language"
          className={styles.select}
          value={config.language.source}
          onChange={(event) =>
            void change({
              path: 'language.source',
              value: event.target.value as LanguageCode | 'auto',
            })
          }
        >
          <option value="auto">自动检测</option>
          {LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingText}>
          <span id="theme-label" className={styles.settingName}>
            外观
          </span>
          <span className={styles.settingHint}>设置页和工具栏面板的主题</span>
        </div>
        <fieldset
          aria-labelledby="theme-label"
          className={styles.segmented}
          style={{ '--index': themeIndex } as React.CSSProperties}
        >
          <span aria-hidden="true" className={styles.segmentThumb} />
          {THEMES.map((theme) => (
            <label key={theme} className={styles.segment}>
              <input
                type="radio"
                name="theme"
                className={styles.radioInput}
                checked={config.ui.theme === theme}
                onChange={() => void change({ path: 'ui.theme', value: theme })}
              />
              {THEME_LABELS[theme]}
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  );
}
