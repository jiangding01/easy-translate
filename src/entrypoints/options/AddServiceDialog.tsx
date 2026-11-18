import { useEffect, useId, useRef, useState } from 'react';
import { i18n } from '#i18n';
import {
  CUSTOM_PROVIDER_LIMITS,
  type CustomProviderId,
  MAX_CUSTOM_PROVIDERS,
} from '@/lib/config/types';
import { useConfig } from '@/lib/config/use-config';
import { normalizeBaseURL, requiredHostPermission } from '@/lib/endpoint';
import { describeError } from '@/lib/error-messages';
import { requestHostPermission } from '@/lib/host-permission';
import { admin } from './hooks';
import { useNotice } from './notice';
import styles from './options.module.css';
import { defaultProviderName, newCustomId, PRESETS } from './providers';

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

const DIALOG_WIDTH = 640;
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
  const modelInput = useRef<HTMLInputElement>(null);
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
      // The preset already fills the address; the model is what the user types next.
      modelInput.current?.focus();
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
      setError(i18n.t('options.services.limitReached', [String(MAX_CUSTOM_PROVIDERS)]));
      return;
    }
    setBusy(true);
    // First await of the click: the permission prompt needs the user gesture.
    const granted = endpoint.data ? await requestHostPermission(endpoint.data.pattern) : true;
    const id = newCustomId(existingIds);
    const baseURL = normalizeBaseURL(draft.baseURL);
    const name = draft.name.trim() || defaultProviderName(preset, baseURL);
    const added = await patch([
      { path: 'customProviders', key: id, add: { name, baseURL, model: draft.model.trim() } },
    ]);
    if (!added.ok) {
      setBusy(false);
      setError(describeError(added.error, i18n.t('errors.action.addFailed')));
      return;
    }
    const key = draft.key.trim();
    if (key) {
      const saved = await admin.setSecret(id, key);
      if (!saved.ok) {
        // The provider exists; the key can be pasted again in its details.
        setBusy(false);
        onAdded(id, granted);
        notice.failed(saved.error, i18n.t('options.add.keyNotSaved'));
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
              {i18n.t('options.add.title')}
            </h2>
            <p className={styles.dialogSub}>{i18n.t('options.add.sub')}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={i18n.t('options.add.close')}
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
            <legend className={styles.visuallyHidden}>{i18n.t('options.add.presets')}</legend>
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
                {i18n.t(item.label)}
              </label>
            ))}
          </fieldset>

          <label className={styles.dialogField}>
            <span className={styles.label}>{i18n.t('options.add.name')}</span>
            <input
              className={styles.input}
              maxLength={CUSTOM_PROVIDER_LIMITS.name}
              value={draft.name}
              onChange={set('name')}
              placeholder={
                defaultProviderName(preset, draft.baseURL) || i18n.t('options.add.namePlaceholder')
              }
            />
          </label>
          <div className={styles.dialogField}>
            <label className={styles.label} htmlFor={`${titleId}-base`}>
              {i18n.t('options.add.baseUrl')}
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
                maxLength={CUSTOM_PROVIDER_LIMITS.baseURL}
                aria-invalid={baseInvalid}
                required
              />
              {baseInvalid && (
                <span className={`${styles.appear} ${styles.fieldError}`}>
                  {i18n.t('options.add.baseUrlInvalid')}
                </span>
              )}
            </div>
          </div>
          <label className={styles.dialogField}>
            <span className={styles.label}>{i18n.t('options.add.apiKey')}</span>
            <input
              className={`${styles.input} ${styles.mono}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.key}
              onChange={set('key')}
              placeholder={
                preset?.local
                  ? i18n.t('options.add.keyPlaceholderLocal')
                  : i18n.t('options.add.keyPlaceholderOptional')
              }
            />
          </label>
          <label className={styles.dialogField}>
            <span className={styles.label}>{i18n.t('options.add.model')}</span>
            <input
              className={`${styles.input} ${styles.mono}`}
              spellCheck={false}
              maxLength={CUSTOM_PROVIDER_LIMITS.model}
              ref={modelInput}
              value={draft.model}
              onChange={set('model')}
              placeholder={i18n.t('options.add.modelPlaceholder')}
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
              (endpoint.ok && endpoint.data === null ? '' : i18n.t('options.add.accessHint'))}
          </span>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            {i18n.t('options.add.cancel')}
          </button>
          <button type="submit" className={styles.primary} disabled={!ready}>
            {busy ? i18n.t('options.add.adding') : i18n.t('options.add.submit')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
