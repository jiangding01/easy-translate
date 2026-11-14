import { useEffect, useId, useRef, useState } from 'react';
import { type CustomProviderId, MAX_CUSTOM_PROVIDERS } from '@/lib/config/types';
import { useConfig } from '@/lib/config/use-config';
import { normalizeBaseURL, requiredHostPermission } from '@/lib/endpoint';
import { defaultProviderName, newCustomId, PRESETS } from '@/lib/engine-view';
import { describeError } from '@/lib/error-messages';
import { requestHostPermission } from '@/lib/host-permission';
import { admin } from './hooks';
import { useNotice } from './notice';
import styles from './options.module.css';

interface Props {
  open: boolean;
  /** Where the dialog grows from (the "添加服务" button). */
  origin: HTMLElement | null;
  existingIds: readonly string[];
  onClose(): void;
  onAdded(id: CustomProviderId, granted: boolean): void;
}

interface Draft {
  preset: string;
  name: string;
  baseURL: string;
  key: string;
  model: string;
}

const DIALOG_WIDTH = 520;
const DIALOG_TOP = 96;

const emptyDraft = (): Draft => ({
  preset: PRESETS[0]?.id ?? 'other',
  name: '',
  baseURL: PRESETS[0]?.baseURL ?? '',
  key: '',
  model: '',
});

/**
 * Native modal dialog: focus is trapped and Esc closes it for free. It grows
 * out of the button that opened it, and the host permission is requested
 * inside the "添加" click, as the browser requires.
 */
export function AddServiceDialog({ open, origin, existingIds, onClose, onAdded }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { patch } = useConfig();
  const notice = useNotice();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(emptyDraft());
      setTouched(false);
      setError(undefined);
      setBusy(false);
      if (origin) {
        const button = origin.getBoundingClientRect();
        const width = Math.min(DIALOG_WIDTH, window.innerWidth - 32);
        const left = (window.innerWidth - width) / 2;
        dialog.style.transformOrigin = `${button.left + button.width / 2 - left}px ${button.top + button.height / 2 - DIALOG_TOP}px`;
      }
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, origin]);

  const preset = PRESETS.find((item) => item.id === draft.preset);
  const endpoint = requiredHostPermission(draft.baseURL);
  const baseInvalid = touched && !endpoint.ok;
  const ready = draft.baseURL.trim() !== '' && draft.model.trim() !== '' && !busy;
  const set = (field: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === 'baseURL') setTouched(false);
    setError(undefined);
  };

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!endpoint.ok) {
      setTouched(true);
      return;
    }
    if (existingIds.length >= MAX_CUSTOM_PROVIDERS) {
      setError(`最多添加 ${MAX_CUSTOM_PROVIDERS} 个自定义服务`);
      return;
    }
    setBusy(true);
    // First await of the click: the permission prompt needs the user gesture.
    const granted = endpoint.data ? await requestHostPermission(endpoint.data.pattern) : true;
    const id = newCustomId(existingIds);
    const baseURL = normalizeBaseURL(draft.baseURL);
    const name = draft.name.trim() || defaultProviderName(preset, baseURL);
    const added = await patch([
      { path: 'customProviders', key: id, value: { name, baseURL, model: draft.model.trim() } },
    ]);
    if (!added.ok) {
      setBusy(false);
      setError(describeError(added.error, '添加失败，请重试。'));
      return;
    }
    const key = draft.key.trim();
    if (key) {
      const saved = await admin.setSecret(id, key);
      if (!saved.ok) {
        // The provider exists; the key can be pasted again in its details.
        setBusy(false);
        onAdded(id, granted);
        notice.failed(saved.error, '服务已添加，但密钥没有保存，请在详情里重新粘贴。');
        return;
      }
    }
    setBusy(false);
    onAdded(id, granted);
  }

  return (
    // Esc is handled natively (onCancel); the click only adds close-on-backdrop.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Esc
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <form className={styles.dialogForm} onSubmit={(event) => void submit(event)}>
        <header className={styles.dialogHeader}>
          <div>
            <h2 id={titleId} className={styles.dialogTitle}>
              添加服务
            </h2>
            <p className={styles.dialogSub}>
              任何兼容 OpenAI 接口的服务都可以添加，包括本机运行的模型。
            </p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="关闭"
            onClick={onClose}
            disabled={busy}
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </header>

        <div className={styles.dialogBody}>
          <fieldset className={styles.chips}>
            <legend className={styles.visuallyHidden}>常用服务</legend>
            {PRESETS.map((item) => (
              <label key={item.id} className={styles.chip}>
                <input
                  type="radio"
                  name="preset"
                  className={styles.radioInput}
                  checked={draft.preset === item.id}
                  onChange={() => {
                    setDraft((current) => ({ ...current, preset: item.id, baseURL: item.baseURL }));
                    setTouched(false);
                    setError(undefined);
                  }}
                />
                {item.label}
              </label>
            ))}
          </fieldset>

          <label className={styles.dialogField}>
            <span className={styles.label}>名称</span>
            <input
              className={styles.input}
              maxLength={40}
              value={draft.name}
              onChange={set('name')}
              placeholder={defaultProviderName(preset, draft.baseURL) || '留空则使用域名'}
            />
          </label>
          <div className={styles.dialogField}>
            <label className={styles.label} htmlFor={`${titleId}-base`}>
              Base URL
            </label>
            <div className={styles.fieldStack}>
              <input
                id={`${titleId}-base`}
                className={`${styles.input} ${styles.mono}`}
                spellCheck={false}
                value={draft.baseURL}
                onChange={set('baseURL')}
                onBlur={() => draft.baseURL.trim() !== '' && setTouched(true)}
                placeholder="https://example.com/v1"
                aria-invalid={baseInvalid}
                required
              />
              {baseInvalid && (
                <span className={`${styles.appear} ${styles.fieldError}`}>
                  请填写 https 开头的地址，本地模型可用 http://localhost
                </span>
              )}
            </div>
          </div>
          <label className={styles.dialogField}>
            <span className={styles.label}>API Key</span>
            <input
              className={`${styles.input} ${styles.mono}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.key}
              onChange={set('key')}
              placeholder={preset?.local ? '本地服务通常不需要' : '没有可以不填'}
            />
          </label>
          <label className={styles.dialogField}>
            <span className={styles.label}>模型</span>
            <input
              className={`${styles.input} ${styles.mono}`}
              spellCheck={false}
              maxLength={200}
              value={draft.model}
              onChange={set('model')}
              placeholder="填写模型 ID"
              required
            />
          </label>
        </div>

        <footer className={styles.dialogFooter}>
          <span
            className={error ? styles.dialogError : styles.hint}
            role={error ? 'alert' : undefined}
          >
            {error ??
              (endpoint.ok && endpoint.data === null
                ? ''
                : '添加时浏览器会询问是否允许访问这个地址')}
          </span>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className={styles.primary} disabled={!ready}>
            {busy ? '添加中…' : '添加'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
