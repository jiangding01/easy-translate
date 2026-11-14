import { useEffect, useId, useState } from 'react';
import { DEFAULT_OPENAI_BASE_URL } from '@/lib/config/defaults';
import {
  type ConfigChange,
  type ConfigV1,
  type CustomProvider,
  isBuiltinEngine,
} from '@/lib/config/types';
import { useConfig } from '@/lib/config/use-config';
import { normalizeBaseURL, requiredHostPermission } from '@/lib/endpoint';
import {
  BUILTIN_META,
  type EngineEntry,
  editableBaseURL,
  engineReadiness,
  hostOf,
  modelOf,
  permissionPattern,
} from '@/lib/engine-view';
import { appError } from '@/lib/errors';
import { requestHostPermission, useHostPermission } from '@/lib/host-permission';
import type { SecretStatusInfo } from '@/lib/messaging/protocol';
import { admin } from './hooks';
import { useNotice } from './notice';
import styles from './options.module.css';
import { TestStrip } from './TestStrip';

interface Props {
  entry: EngineEntry;
  config: ConfigV1;
  isDefault: boolean;
  expanded: boolean;
  /** Just added: highlight once and run a connection test. */
  fresh: boolean;
  secret: SecretStatusInfo | undefined;
  onToggle(): void;
  onMakeDefault(): void;
  onSecretsChanged(): void;
  onDelete(): Promise<void>;
}

type TextField = 'name' | 'baseURL' | 'model';

export function EngineItem(props: Props) {
  const { entry, config, isDefault, expanded, fresh, secret } = props;
  const { patch } = useConfig();
  const notice = useNotice();
  const panelId = useId();
  const { id: engine, custom } = entry;
  const builtin = isBuiltinEngine(engine);
  const hasBase = engine === 'openai' || !builtin;
  const takesKey = engine !== 'google';

  const saved: Record<TextField, string> = {
    name: custom?.name ?? '',
    baseURL: editableBaseURL(config, engine),
    model: modelOf(config, engine),
  };
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState<TextField>();
  const [baseError, setBaseError] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Follow changes made elsewhere (another tab, a reset), except in the field being typed in.
  const savedKey = `${saved.name}\n${saved.baseURL}\n${saved.model}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: savedKey captures `saved`
  useEffect(() => {
    setDraft((current) => ({
      name: editing === 'name' ? current.name : saved.name,
      baseURL: editing === 'baseURL' ? current.baseURL : saved.baseURL,
      model: editing === 'model' ? current.model : saved.model,
    }));
  }, [savedKey]);

  const pattern = hasBase ? permissionPattern(saved.baseURL) : undefined;
  const granted = useHostPermission(pattern);
  const readiness = engineReadiness({ engine, model: saved.model, secret, granted });

  async function apply(change: ConfigChange, text = '已保存') {
    const result = await patch([change]);
    if (result.ok) notice.saved(text);
    else notice.failed(result.error);
  }

  function customChange(next: Partial<CustomProvider>): ConfigChange | undefined {
    if (!custom || builtin) return undefined;
    return { path: 'customProviders', key: engine, value: { ...custom, ...next } };
  }

  async function commit(field: TextField) {
    setEditing(undefined);
    const value = draft[field].trim();
    if (field === 'baseURL') {
      const empty = value === '';
      const valid = empty ? engine === 'openai' : requiredHostPermission(value).ok;
      setBaseError(!valid);
      if (!valid) return;
      const next = empty ? DEFAULT_OPENAI_BASE_URL : normalizeBaseURL(value);
      setDraft((current) => ({ ...current, baseURL: next }));
      if (next === saved.baseURL) return;
      const change =
        engine === 'openai'
          ? { path: 'providers.openai.baseURL' as const, value: next }
          : customChange({ baseURL: next });
      if (change) await apply(change);
      return;
    }
    if (value === saved[field]) return;
    if (field === 'name') {
      const change = customChange({ name: value || hostOf(saved.baseURL) });
      if (change) await apply(change);
      return;
    }
    let change: ConfigChange | undefined;
    if (engine === 'openai') change = { path: 'providers.openai.model', value };
    else if (engine === 'deepseek') change = { path: 'providers.deepseek.model', value };
    else if (engine === 'gemini') change = { path: 'providers.gemini.model', value };
    else change = customChange({ model: value });
    if (change) await apply(change);
  }

  async function saveKey() {
    const value = keyDraft.trim();
    if (!value || engine === 'google') return;
    const result = await admin.setSecret(engine, value);
    if (result.ok) {
      setKeyDraft('');
      setShowKey(false);
      props.onSecretsChanged();
      notice.saved('已保存密钥');
    } else {
      notice.failed(result.error);
    }
  }

  async function clearKey() {
    if (engine === 'google') return;
    const result = await admin.setSecret(engine, null);
    if (result.ok) {
      props.onSecretsChanged();
      notice.saved('已清除密钥');
    } else {
      notice.failed(result.error);
    }
  }

  async function grant() {
    if (!pattern) return;
    const ok = await requestHostPermission(pattern);
    if (ok) notice.saved('已授权');
    else
      notice.failed(appError('config', 'config/permission-missing', 'Permission was not granted'));
  }

  const keyed = secret?.configured === true;
  let blocked: string | undefined;
  if (hasBase && !requiredHostPermission(draft.baseURL).ok) blocked = '先填写正确的地址';
  else if (granted === false) blocked = '授权后可以测试';
  else if (builtin && takesKey && !keyed && keyDraft.trim() === '')
    blocked = '填写 API Key 后可以测试';
  else if (takesKey && draft.model.trim() === '') blocked = '填写模型后可以测试';

  const sub = rowSubtitle(engine, saved, config);
  const link = builtin ? BUILTIN_META[engine].link : undefined;
  const field = (name: TextField) => ({
    value: draft[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setDraft((current) => ({ ...current, [name]: value }));
      if (name === 'baseURL') setBaseError(false);
    },
    onFocus: () => setEditing(name),
    onBlur: () => void commit(name),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') event.currentTarget.blur();
    },
  });

  return (
    <div
      className={[styles.item, expanded ? styles.itemOpen : '', fresh ? styles.rowFlash : ''].join(
        ' ',
      )}
    >
      <div className={styles.row}>
        <button
          type="button"
          className={styles.radio}
          aria-pressed={isDefault}
          aria-label={`设为默认引擎：${entry.name}`}
          onClick={props.onMakeDefault}
        >
          <span aria-hidden="true" className={styles.radioMark} />
        </button>
        <button
          type="button"
          className={styles.rowMain}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={props.onToggle}
        >
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>
              <span className={styles.rowName}>{entry.name}</span>
              {isDefault && <span className={styles.defaultTag}>默认</span>}
            </span>
            <span className={styles.rowSub}>{sub}</span>
          </span>
          <span className={styles.rowStatus}>
            {readiness.attention && <span aria-hidden="true" className={styles.warnDot} />}
            <span className={readiness.mono ? styles.mono : undefined}>{readiness.status}</span>
          </span>
          <svg
            aria-hidden="true"
            className={styles.chevron}
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </button>
      </div>

      <div className={styles.panel} id={panelId} inert={!expanded}>
        <div className={styles.panelClip}>
          <div className={styles.panelInner}>
            {engine === 'google' && (
              <p className={styles.note}>
                免费，无需配置。网页文字会发送到 Google
                翻译。遇到限流时会自动放慢；如果持续受限，会建议你换一个引擎。
              </p>
            )}

            {!builtin && (
              <label className={styles.field}>
                <span className={styles.label}>名称</span>
                <input
                  className={styles.input}
                  maxLength={40}
                  placeholder={hostOf(saved.baseURL)}
                  {...field('name')}
                />
              </label>
            )}

            {hasBase && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${panelId}-base`}>
                  Base URL
                </label>
                <div className={styles.fieldStack}>
                  <input
                    id={`${panelId}-base`}
                    className={`${styles.input} ${styles.mono}`}
                    spellCheck={false}
                    placeholder={
                      engine === 'openai' ? DEFAULT_OPENAI_BASE_URL : 'https://example.com/v1'
                    }
                    aria-invalid={baseError}
                    {...field('baseURL')}
                  />
                  {baseError && (
                    <span className={`${styles.appear} ${styles.fieldError}`}>
                      请填写 https 开头的地址，本地模型可用 http://localhost
                    </span>
                  )}
                </div>
              </div>
            )}

            {takesKey && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${panelId}-key`}>
                  API Key
                </label>
                <div className={styles.fieldStack}>
                  <div className={styles.inline}>
                    <input
                      id={`${panelId}-key`}
                      className={`${styles.input} ${styles.mono}`}
                      type={showKey ? 'text' : 'password'}
                      autoComplete="off"
                      spellCheck={false}
                      value={keyDraft}
                      placeholder={keyPlaceholder(builtin, secret)}
                      onChange={(event) => setKeyDraft(event.target.value)}
                      onBlur={(event) => {
                        // "显示" keeps the draft: it only reveals what is being typed.
                        if (
                          event.relatedTarget instanceof HTMLElement &&
                          event.relatedTarget.dataset.keepKey
                        )
                          return;
                        void saveKey();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                    />
                    {keyDraft !== '' && (
                      <button
                        type="button"
                        className={styles.ghost}
                        data-keep-key="true"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? '隐藏' : '显示'}
                      </button>
                    )}
                    {keyed && keyDraft === '' && (
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => void clearKey()}
                      >
                        清除
                      </button>
                    )}
                  </div>
                  <span className={styles.hint}>
                    <svg
                      aria-hidden="true"
                      width="11"
                      height="11"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    >
                      <rect x="2.5" y="5.2" width="7" height="5" rx="1.2" />
                      <path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4" />
                    </svg>
                    只保存在这台电脑上，不会导出或同步
                    {link && (
                      <a className={styles.link} href={link.href} target="_blank" rel="noreferrer">
                        {link.label}
                      </a>
                    )}
                  </span>
                </div>
              </div>
            )}

            {takesKey && (
              <label className={styles.field}>
                <span className={styles.label}>模型</span>
                <input
                  className={`${styles.input} ${styles.mono}`}
                  spellCheck={false}
                  maxLength={200}
                  placeholder={
                    engine === 'gemini' ? '填写模型 ID，例如官方列表中的 flash 型号' : '填写模型 ID'
                  }
                  {...field('model')}
                />
              </label>
            )}

            {pattern && granted === false && (
              <div className={styles.field}>
                <span className={styles.label}>访问权限</span>
                <div className={styles.inline}>
                  <span className={styles.grantText}>
                    需要允许扩展访问 <span className={styles.mono}>{hostOf(saved.baseURL)}</span>
                  </span>
                  <button type="button" className={styles.ghostStrong} onClick={() => void grant()}>
                    授权访问
                  </button>
                </div>
              </div>
            )}

            {expanded && (
              <TestStrip
                autoRun={fresh}
                blocked={blocked}
                run={() =>
                  admin.test({
                    engine,
                    baseURL: draft.baseURL,
                    model: draft.model.trim(),
                    apiKey: keyDraft.trim() || undefined,
                  })
                }
              />
            )}

            <div className={styles.itemFooter}>
              {isDefault ? (
                <span className={styles.hint}>这是当前的默认引擎</span>
              ) : (
                <button type="button" className={styles.textButton} onClick={props.onMakeDefault}>
                  设为默认引擎
                </button>
              )}
              <span className={styles.spacer} />
              {!builtin && !confirmDelete && (
                <button
                  type="button"
                  className={styles.dangerText}
                  onClick={() => setConfirmDelete(true)}
                >
                  删除此服务
                </button>
              )}
              {!builtin && confirmDelete && (
                <span className={`${styles.appear} ${styles.inline}`}>
                  <span className={styles.hint}>
                    {isDefault ? '删除后默认改用 Google 翻译' : '删除后无法恢复'}
                  </span>
                  <button
                    type="button"
                    className={styles.ghostSmall}
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className={styles.danger}
                    onClick={() => void props.onDelete()}
                  >
                    删除
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function keyPlaceholder(builtin: boolean, secret: SecretStatusInfo | undefined): string {
  if (secret?.configured) {
    return secret.last4
      ? `已保存 ••••${secret.last4}，粘贴新密钥可替换`
      : '已保存，粘贴新密钥可替换';
  }
  return builtin ? '粘贴密钥，离开输入框时自动保存' : '没有可以不填';
}

function rowSubtitle(
  engine: EngineEntry['id'],
  saved: Record<TextField, string>,
  config: ConfigV1,
): string {
  switch (engine) {
    case 'google':
      return '免费 · 无需配置';
    case 'openai': {
      const host = hostOf(saved.baseURL);
      const model = saved.model || '未填写模型';
      return host && host !== 'api.openai.com' ? `${host} · ${model}` : model;
    }
    case 'deepseek':
      return saved.model || '未填写模型';
    case 'gemini':
      return saved.model || '需要填写模型 ID';
    default: {
      const custom = config.customProviders[engine];
      return `${hostOf(custom?.baseURL ?? '')} · ${saved.model || '未填写模型'}`;
    }
  }
}
