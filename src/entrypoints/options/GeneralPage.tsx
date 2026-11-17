import { createElement, useEffect, useState } from 'react';
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

const SOURCE_OPTIONS: SelectOption<LanguageCode | 'auto'>[] = [
  { value: 'auto', label: '自动检测', sub: '推荐' },
  ...TARGET_OPTIONS,
];

const THEME_LABELS: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' };
const STYLE_LABELS: Record<PageStyle, string> = {
  plain: '无装饰',
  faded: '淡化',
  underline: '下划线',
  highlight: '高亮',
};
const MODE_LABELS: Record<PageMode, string> = { bilingual: '双语', translation: '仅译文' };
const DOCK_LABELS: Record<IsleDock, string> = { right: '右侧', left: '左侧', bottom: '底部' };
const DOT_OPTIONS = [
  { value: true, label: '开' },
  { value: false, label: '关' },
] as const;
const HOSTS = ['light', 'dark'] as const;
const HOST_LABELS: Record<(typeof HOSTS)[number], string> = { light: '浅色网页', dark: '深色网页' };

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
      <section aria-label="通用" className={styles.card}>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <label
              id="target-language-label"
              htmlFor="target-language"
              className={styles.settingName}
            >
              目标语言
            </label>
            <span className={styles.settingHint}>网页会被翻译成这种语言</span>
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
              源语言
            </label>
            <span className={styles.settingHint}>自动检测适合大多数网页；检测不准时再手动指定</span>
          </div>
          <Select
            id="source-language"
            labelledBy="source-language-label"
            align="end"
            minWidth={200}
            value={config.language.source}
            options={SOURCE_OPTIONS}
            onChange={(value) => void change({ path: 'language.source', value })}
          />
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
            译文
          </h2>
          <span className={styles.headHint}>
            译文沿用网页自己的字体、字号和颜色，样式只决定怎样和原文区分
          </span>
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.styleBlock}>
          <div className={styles.styleHead}>
            <span id="style-label" className={styles.settingName}>
              样式
            </span>
            <fieldset
              aria-label="预览底色"
              className={styles.segmented}
              style={{ '--index': HOSTS.indexOf(host), '--seg-w': '84px' } as React.CSSProperties}
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
                  {HOST_LABELS[item]}
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
                  {STYLE_LABELS[item]}
                  {item === 'faded' && <span className={styles.defaultTag}>默认</span>}
                </span>
                <span className={styles.sample} data-host={host}>
                  Less, but better.
                  <Translation style={item} dark={dark}>
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
              好的软件也是如此：在你需要之前，它不挡你的路；需要时，它就在那里。
            </Translation>
          </div>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span id="mode-label" className={styles.settingName}>
              打开时显示
            </span>
            <span className={styles.settingHint}>每次开始翻译时的显示方式，翻译中可以随时切换</span>
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
                {MODE_LABELS[item]}
              </label>
            ))}
          </fieldset>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span id="dock-label" className={styles.settingName}>
              灵岛位置
            </span>
            <span className={styles.settingHint}>
              翻译时贴在网页边缘的控制条，正在翻译的页面立即生效
            </span>
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
                {DOCK_LABELS[item]}
              </label>
            ))}
          </fieldset>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span id="dot-label" className={styles.settingName}>
              划词小点
            </span>
            <span className={styles.settingHint}>选中外文后在末尾显示翻译小点</span>
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
                {item.label}
              </label>
            ))}
          </fieldset>
        </div>
      </div>
    </section>
  );
}
