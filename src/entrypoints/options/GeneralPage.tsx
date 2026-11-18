import { createElement, useEffect, useState } from 'react';
import { i18n } from '#i18n';
import { Select, type SelectOption } from '@/components/Select';
import { injectStyles, removeStyles } from '@/content/styles';
import {
  type ConfigChange,
  type ConfigV1,
  ISLE_DOCKS,
  type IsleDock,
  PAGE_MODES,
  PAGE_STYLES,
  type PageMode,
  type PageStyle,
  THEMES,
  type Theme,
} from '@/lib/config/types';
import { useConfig } from '@/lib/config/use-config';
import { LANGUAGES, type LanguageCode } from '@/lib/languages';
import { useNotice } from './notice';
import styles from './options.module.css';

const TARGET_OPTIONS: SelectOption<LanguageCode>[] = LANGUAGES.map((language) => ({
  value: language.code,
  label: language.name,
  sub: language.code,
  lang: language.code,
}));

// Option tables hold copy keys only: the text is looked up at render, never at module load.
const sourceOptions = (): SelectOption<LanguageCode | 'auto'>[] => [
  { value: 'auto', label: i18n.t('common.autoDetect'), sub: i18n.t('options.general.recommended') },
  ...TARGET_OPTIONS,
];

const THEME_LABELS = {
  system: 'options.general.themeSystem',
  light: 'options.general.themeLight',
  dark: 'options.general.themeDark',
} as const satisfies Record<Theme, string>;
const STYLE_LABELS = {
  plain: 'options.general.styleNone',
  faded: 'options.general.styleFaded',
  underline: 'options.general.styleUnderline',
  highlight: 'options.general.styleHighlight',
} as const satisfies Record<PageStyle, string>;
const MODE_LABELS = {
  bilingual: 'common.modeBilingual',
  translation: 'common.modeTranslation',
} as const satisfies Record<PageMode, string>;
const DOCK_LABELS = {
  right: 'options.general.dockRight',
  left: 'options.general.dockLeft',
  bottom: 'options.general.dockBottom',
} as const satisfies Record<IsleDock, string>;
const DOT_OPTIONS = [
  { value: true, label: 'options.general.dotOn' },
  { value: false, label: 'options.general.dotOff' },
] as const;
const HOSTS = ['light', 'dark'] as const;
const HOST_LABELS = {
  light: 'options.general.hostLight',
  dark: 'options.general.hostDark',
} as const satisfies Record<(typeof HOSTS)[number], string>;

/** The real `<et-tr>` with the page stylesheet, so the preview cannot drift from the page. */
function Translation({
  style,
  dark,
  className,
  children,
}: {
  style: PageStyle;
  dark: boolean;
  className?: string;
  children: string;
}) {
  return createElement(
    'et-tr',
    {
      'data-et-s': style,
      'data-et-host': dark ? 'dark' : undefined,
      lang: 'zh-CN',
      className,
    },
    children,
  );
}

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
    <>
      <section aria-label={i18n.t('options.nav.general')} className={styles.card}>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <label
              id="target-language-label"
              htmlFor="target-language"
              className={styles.settingName}
            >
              {i18n.t('options.general.targetLanguage')}
            </label>
            <span className={styles.settingHint}>
              {i18n.t('options.general.targetLanguageHint')}
            </span>
          </div>
          <Select
            id="target-language"
            labelledBy="target-language-label"
            align="end"
            minWidth={200}
            value={config.language.target}
            options={TARGET_OPTIONS}
            onChange={(value) => void change({ path: 'language.target', value })}
          />
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <label
              id="source-language-label"
              htmlFor="source-language"
              className={styles.settingName}
            >
              {i18n.t('options.general.sourceLanguage')}
            </label>
            <span className={styles.settingHint}>
              {i18n.t('options.general.sourceLanguageHint')}
            </span>
          </div>
          <Select
            id="source-language"
            labelledBy="source-language-label"
            align="end"
            minWidth={200}
            value={config.language.source}
            options={sourceOptions()}
            onChange={(value) => void change({ path: 'language.source', value })}
          />
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span id="theme-label" className={styles.settingName}>
              {i18n.t('options.general.appearance')}
            </span>
            <span className={styles.settingHint}>{i18n.t('options.general.appearanceHint')}</span>
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
                {i18n.t(THEME_LABELS[theme])}
              </label>
            ))}
          </fieldset>
        </div>
      </section>
      <TranslationSection config={config} change={change} />
    </>
  );
}

function TranslationSection({
  config,
  change,
}: {
  config: ConfigV1;
  change: (next: ConfigChange) => Promise<void>;
}) {
  const [host, setHost] = useState<(typeof HOSTS)[number]>('light');
  const dark = host === 'dark';
  const { style, mode, isleDock } = config.page;
  const { showDot } = config.selection;

  useEffect(() => {
    const sheet = injectStyles(document);
    return () => removeStyles(sheet);
  }, []);

  return (
    <section aria-labelledby="translation-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <h2 id="translation-title" className={styles.sectionTitle}>
            {i18n.t('options.general.translationTitle')}
          </h2>
          <span className={styles.headHint}>{i18n.t('options.general.translationHint')}</span>
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.styleBlock}>
          <div className={styles.styleHead}>
            <span id="style-label" className={styles.settingName}>
              {i18n.t('options.general.style')}
            </span>
            <fieldset
              aria-label={i18n.t('options.general.previewHost')}
              className={styles.segmented}
              style={{ '--index': HOSTS.indexOf(host), '--seg-min': '84px' } as React.CSSProperties}
            >
              <span aria-hidden="true" className={styles.segmentThumb} />
              {HOSTS.map((item) => (
                <label key={item} className={styles.segment}>
                  <input
                    type="radio"
                    name="preview-host"
                    className={styles.radioInput}
                    checked={host === item}
                    onChange={() => setHost(item)}
                  />
                  {i18n.t(HOST_LABELS[item])}
                </label>
              ))}
            </fieldset>
          </div>
          <fieldset aria-labelledby="style-label" className={styles.styleGrid}>
            {PAGE_STYLES.map((item) => (
              <label key={item} className={styles.styleOption}>
                <input
                  type="radio"
                  name="page-style"
                  className={styles.radioInput}
                  checked={style === item}
                  onChange={() => void change({ path: 'page.style', value: item })}
                />
                <span className={styles.styleName}>
                  {i18n.t(STYLE_LABELS[item])}
                  {item === 'faded' && (
                    <span className={styles.defaultTag}>
                      {i18n.t('options.general.defaultBadge')}
                    </span>
                  )}
                </span>
                <span className={styles.sample} data-host={host}>
                  Less, but better.
                  <Translation style={item} dark={dark}>
                    {/* i18n-ignore: a sample translation on a web page, not UI copy */}
                    少，但更好。
                  </Translation>
                </span>
              </label>
            ))}
          </fieldset>
          <div className={`${styles.sample} ${styles.preview}`} data-host={host} aria-hidden="true">
            Good software works the same way: it stays out of your way until you need it, then it is
            simply there.
            <Translation key={style} style={style} dark={dark} className={styles.previewIn}>
              {/* i18n-ignore: a sample translation on a web page, not UI copy */}
              好的软件也是如此：在你需要之前，它不挡你的路；需要时，它就在那里。
            </Translation>
          </div>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span id="mode-label" className={styles.settingName}>
              {i18n.t('options.general.openShows')}
            </span>
            <span className={styles.settingHint}>{i18n.t('options.general.openShowsHint')}</span>
          </div>
          <fieldset
            aria-labelledby="mode-label"
            className={styles.segmented}
            style={{ '--index': PAGE_MODES.indexOf(mode) } as React.CSSProperties}
          >
            <span aria-hidden="true" className={styles.segmentThumb} />
            {PAGE_MODES.map((item) => (
              <label key={item} className={styles.segment}>
                <input
                  type="radio"
                  name="page-mode"
                  className={styles.radioInput}
                  checked={mode === item}
                  onChange={() => void change({ path: 'page.mode', value: item })}
                />
                {i18n.t(MODE_LABELS[item])}
              </label>
            ))}
          </fieldset>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span id="dock-label" className={styles.settingName}>
              {i18n.t('options.general.dock')}
            </span>
            <span className={styles.settingHint}>{i18n.t('options.general.dockHint')}</span>
          </div>
          <fieldset
            aria-labelledby="dock-label"
            className={styles.segmented}
            style={{ '--index': ISLE_DOCKS.indexOf(isleDock) } as React.CSSProperties}
          >
            <span aria-hidden="true" className={styles.segmentThumb} />
            {ISLE_DOCKS.map((item) => (
              <label key={item} className={styles.segment}>
                <input
                  type="radio"
                  name="isle-dock"
                  className={styles.radioInput}
                  checked={isleDock === item}
                  onChange={() => void change({ path: 'page.isleDock', value: item })}
                />
                {i18n.t(DOCK_LABELS[item])}
              </label>
            ))}
          </fieldset>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span id="dot-label" className={styles.settingName}>
              {i18n.t('options.general.dot')}
            </span>
            <span className={styles.settingHint}>{i18n.t('options.general.dotHint')}</span>
          </div>
          <fieldset
            aria-labelledby="dot-label"
            className={styles.segmented}
            style={{ '--index': showDot ? 0 : 1 } as React.CSSProperties}
          >
            <span aria-hidden="true" className={styles.segmentThumb} />
            {DOT_OPTIONS.map((item) => (
              <label key={item.label} className={styles.segment}>
                <input
                  type="radio"
                  name="selection-dot"
                  className={styles.radioInput}
                  checked={showDot === item.value}
                  onChange={() => void change({ path: 'selection.showDot', value: item.value })}
                />
                {i18n.t(item.label)}
              </label>
            ))}
          </fieldset>
        </div>
      </div>
    </section>
  );
}
