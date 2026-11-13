import type { ConfigChange, ConfigV1, Theme } from '@/lib/config/types';
import { LANGUAGES, type LanguageCode } from '@/lib/languages';
import styles from '@/styles/ui.module.css';

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

interface Props {
  /** Always the storage snapshot: the controls hold no local state. */
  value: ConfigV1;
  onChange: (change: ConfigChange) => void;
  disabled?: boolean;
}

export function SettingsFields({ value, onChange, disabled }: Props) {
  return (
    <fieldset className={styles.fields} disabled={disabled}>
      <label className={styles.field}>
        目标语言
        <select
          value={value.language.target}
          onChange={(event) =>
            onChange({ path: 'language.target', value: event.target.value as LanguageCode })
          }
        >
          {LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        界面主题
        <select
          value={value.ui.theme}
          onChange={(event) => onChange({ path: 'ui.theme', value: event.target.value as Theme })}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
