import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Select, type SelectOption } from '@/components/Select';
import { engineFields, hasEditableBaseURL } from '@/lib/config/engine-fields';
import type { ConfigV1, Engine } from '@/lib/config/types';
import { useConfig } from '@/lib/config/use-config';
import { engineEntries, engineReadiness, permissionPattern } from '@/lib/engine-view';
import { describeError } from '@/lib/error-messages';
import { appError, fail } from '@/lib/errors';
import { useHostPermission } from '@/lib/host-permission';
import { LANGUAGES, type LanguageCode, languageName } from '@/lib/languages';
import { call } from '@/lib/messaging/handle';
import {
  type SecretProviderId,
  type SecretStatusInfo,
  sendMessage,
} from '@/lib/messaging/protocol';
import { useTheme } from '@/styles/theme';
import { type ActivePage, inspectActivePage } from './inspect-page';
import { panelState } from './panel-state';
import styles from './popup.module.css';

const TARGET_OPTIONS: SelectOption<LanguageCode>[] = LANGUAGES.map((language) => ({
  value: language.code,
  label: language.name,
  lang: language.code,
}));

type Statuses = Partial<Record<SecretProviderId, SecretStatusInfo>>;

export function App() {
  const { state, patch } = useConfig();
  const [page, setPage] = useState<ActivePage>();
  const [statuses, setStatuses] = useState<Statuses>();
  const [error, setError] = useState<string>();
  useTheme(state.status === 'ready' ? state.snapshot.data.ui.theme : undefined);

  useEffect(() => {
    void inspectActivePage()
      .catch(
        (): ActivePage => ({
          host: '',
          info: fail(appError('validation', 'validation/unsupported-page', 'No active page')),
        }),
      )
      .then(setPage);
    void call(() => sendMessage('secrets.status', undefined)).then((result) => {
      if (result.ok) setStatuses(result.data);
    });
  }, []);

  if (state.status !== 'ready') {
    return (
      <main className={styles.panel}>
        <p className={styles.quiet} role="status">
          {state.status === 'loading'
            ? '正在加载…'
            : describeError(state.error, '读取设置失败，请重新打开面板。')}
        </p>
      </main>
    );
  }

  const config = state.snapshot.data;
  const target = config.language.target;
  const view = panelState(page, target);

  async function save(change: Parameters<typeof patch>[0][number]) {
    const result = await patch([change]);
    setError(result.ok ? undefined : describeError(result.error, '保存失败，请重试。'));
  }

  const openSettings = () => {
    void browser.runtime.openOptionsPage().catch(() => setError('无法打开设置页，请重试。'));
  };

  return (
    <main className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.host}>
          {view.kind === 'blocked' && '浏览器页面'}
          {view.kind !== 'blocked' && view.kind !== 'loading' && (
            <>
              {view.host}
              {view.kind !== 'unreachable' &&
                ` · ${view.language ? `检测到 ${languageName(view.language)}` : '未声明语言'}`}
            </>
          )}
          {view.kind === 'loading' && ' '}
        </span>
        {(view.kind === 'foreign' || view.kind === 'loading') && (
          <div className={styles.pair}>
            <span>
              {view.kind === 'foreign' && view.language ? languageName(view.language) : '自动检测'}
            </span>
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              className={styles.faint}
            >
              <path d="M2 6h8M7 3l3 3-3 3" />
            </svg>
            <Select
              variant="inline"
              label="翻译成"
              minWidth={180}
              value={target}
              options={TARGET_OPTIONS}
              onChange={(value) => void save({ path: 'language.target', value })}
            />
          </div>
        )}
      </div>

      <div className={styles.body}>
        {view.kind === 'foreign' && (
          <>
            <EngineNotice config={config} statuses={statuses} onOpenSettings={openSettings} />
            <button
              type="button"
              className={styles.primary}
              disabled
              aria-describedby="translate-soon"
            >
              翻译此页
            </button>
            <span id="translate-soon" className={styles.quiet}>
              整页翻译将在下一个版本接入。
            </span>
          </>
        )}
        {view.kind === 'native' && (
          <div className={styles.message}>
            <strong>这一页已经是{languageName(view.language)}</strong>
            <span>不需要翻译。</span>
          </div>
        )}
        {view.kind === 'unreachable' && (
          <div className={styles.message}>
            <strong>需要刷新这个网页</strong>
            <span>扩展安装或更新之后，已经打开的网页要刷新一次才能翻译。</span>
          </div>
        )}
        {view.kind === 'blocked' && (
          <div className={styles.message}>
            <strong>这个页面不能翻译</strong>
            <span>浏览器不允许扩展读取它自己的页面和应用商店页面。换到普通网页再试。</span>
          </div>
        )}
        {view.kind === 'loading' && <span className={styles.quiet}>正在读取页面…</span>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className={styles.footer}>
        <EngineSelect
          config={config}
          statuses={statuses}
          onChange={(engine) => void save({ path: 'translation.engine', value: engine })}
        />
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.iconButton}
          aria-label="打开设置"
          title="设置"
          onClick={openSettings}
        >
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
          </svg>
        </button>
      </footer>
    </main>
  );
}

function useReadiness(config: ConfigV1, statuses: Statuses | undefined) {
  const engine = config.translation.engine;
  const fields = engineFields(config, engine) ?? { baseURL: '', model: '' };
  const granted = useHostPermission(
    hasEditableBaseURL(engine) ? permissionPattern(fields.baseURL) : undefined,
  );
  return engineReadiness({
    engine,
    ...fields,
    secret: engine === 'google' ? undefined : statuses?.[engine],
    granted,
  });
}

/** A quiet line when the default engine cannot translate yet; never a dead end. */
function EngineNotice({
  config,
  statuses,
  onOpenSettings,
}: {
  config: ConfigV1;
  statuses: Statuses | undefined;
  onOpenSettings: () => void;
}) {
  const readiness = useReadiness(config, statuses);
  if (statuses === undefined || !readiness.problem) return null;
  const name = engineEntries(config).find((entry) => entry.id === config.translation.engine)?.name;
  return (
    <div className={styles.notice}>
      <span aria-hidden="true" className={styles.warnDot} />
      <span className={styles.noticeText}>
        {name}
        {readiness.problem}
      </span>
      <button type="button" className={styles.textButton} onClick={onOpenSettings}>
        去设置
      </button>
    </div>
  );
}

function EngineSelect({
  config,
  statuses,
  onChange,
}: {
  config: ConfigV1;
  statuses: Statuses | undefined;
  onChange: (engine: Engine) => void;
}) {
  const readiness = useReadiness(config, statuses);
  const current = config.translation.engine;
  const dot = (problem: boolean): 'ok' | 'warn' | 'idle' =>
    statuses === undefined ? 'idle' : problem ? 'warn' : 'ok';
  // Other engines' grants are not looked up here: their rows show key and model state only.
  const options = engineEntries(config).map((entry): SelectOption<Engine> => {
    const fields = engineFields(config, entry.id) ?? { baseURL: '', model: '' };
    const state =
      entry.id === current
        ? readiness
        : engineReadiness({
            engine: entry.id,
            ...fields,
            secret: entry.id === 'google' ? undefined : statuses?.[entry.id],
            granted: true,
          });
    return { value: entry.id, label: entry.name, sub: state.status, dot: dot(!!state.problem) };
  });
  const selected = options.find((option) => option.value === current);
  return (
    <Select
      variant="quiet"
      label="默认引擎"
      minWidth={236}
      value={current}
      options={options}
      onChange={onChange}
    >
      <span aria-hidden="true" className={`${styles.dot} ${styles[dot(!!readiness.problem)]}`} />
      <span className={styles.engineName}>{selected?.label}</span>
    </Select>
  );
}
