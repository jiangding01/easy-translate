import { targetLanguages, type Settings } from '@/lib/settings';
import styles from '@/styles/ui.module.css';

interface Props {
  value: Settings;
  onChange: (value: Settings) => void;
  disabled?: boolean;
}

export function SettingsFields({ value, onChange, disabled }: Props) {
  return (
    <fieldset className={styles.fields} disabled={disabled}>
      <label className={styles.field}>
        目标语言
        <select value={value.targetLanguage} onChange={(event) => onChange({
          ...value, targetLanguage: event.target.value as Settings['targetLanguage'],
        })}>
          {Object.entries(targetLanguages).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        显示模式
        <select value={value.displayMode} onChange={(event) => onChange({
          ...value, displayMode: event.target.value as Settings['displayMode'],
        })}>
          <option value="bilingual">双语对照</option>
          <option value="replace">替换原文</option>
        </select>
      </label>
    </fieldset>
  );
}
