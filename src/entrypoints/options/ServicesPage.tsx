import { useRef, useState } from 'react';
import {
  type ConfigV1,
  type CustomProviderId,
  type Engine,
  MAX_CUSTOM_PROVIDERS,
} from '@/lib/config/types';
import { useConfig } from '@/lib/config/use-config';
import { engineEntries, patternsInUse, permissionPattern } from '@/lib/engine-view';
import { removeHostPermission } from '@/lib/host-permission';
import { AddServiceDialog } from './AddServiceDialog';
import { CacheSection } from './CacheSection';
import { EngineItem } from './EngineItem';
import { admin, useSecretStatuses } from './hooks';
import { useNotice } from './notice';
import styles from './options.module.css';

export function ServicesPage({ config }: { config: ConfigV1 }) {
  const { patch } = useConfig();
  const notice = useNotice();
  const { statuses, refresh } = useSecretStatuses();
  const [expanded, setExpanded] = useState<Engine | undefined>(config.translation.engine);
  const [fresh, setFresh] = useState<CustomProviderId>();
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);

  const entries = engineEntries(config);
  const customIds = Object.keys(config.customProviders);
  const full = customIds.length >= MAX_CUSTOM_PROVIDERS;
  const firstCustom = entries.find((entry) => entry.custom)?.id;

  async function makeDefault(engine: Engine) {
    if (engine === config.translation.engine) return;
    const result = await patch([{ path: 'translation.engine', value: engine }]);
    if (result.ok) notice.saved('已设为默认');
    else notice.failed(result.error);
  }

  async function remove(id: CustomProviderId) {
    const custom = config.customProviders[id];
    const wasDefault = config.translation.engine === id;
    const result = await patch([{ path: 'customProviders', key: id, value: null }]);
    if (!result.ok) {
      notice.failed(result.error, '删除失败，请重试。');
      return;
    }
    setExpanded(undefined);
    notice.saved(wasDefault ? '已删除，默认改用 Google 翻译' : '已删除');
    // Housekeeping; failures leave only an unused key or grant behind.
    await admin.setSecret(id, null);
    refresh();
    const pattern = custom ? permissionPattern(custom.baseURL) : undefined;
    if (pattern && !patternsInUse(result.data.data).has(pattern))
      await removeHostPermission(pattern);
  }

  return (
    <>
      <section aria-labelledby="engines-title" className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitleRow}>
            <h2 id="engines-title" className={styles.sectionTitle}>
              引擎
            </h2>
            <span className={styles.headHint}>圆点选中的是默认引擎，点一行查看和修改配置</span>
          </div>
          <button
            ref={addButton}
            type="button"
            className={styles.addButton}
            onClick={() => setAdding(true)}
            disabled={full}
            title={
              full
                ? `最多添加 ${MAX_CUSTOM_PROVIDERS} 个自定义服务`
                : '添加一个兼容 OpenAI 接口的服务'
            }
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M6 2v8M2 6h8" />
            </svg>
            添加服务
          </button>
        </div>

        <div className={styles.card}>
          {entries.map((entry) => (
            <div key={entry.id}>
              {entry.id === firstCustom && (
                <div className={styles.groupHead}>
                  <span>自定义 · OpenAI 兼容</span>
                  <span>
                    {customIds.length} / {MAX_CUSTOM_PROVIDERS}
                  </span>
                </div>
              )}
              <EngineItem
                entry={entry}
                config={config}
                isDefault={config.translation.engine === entry.id}
                expanded={expanded === entry.id}
                fresh={fresh === entry.id}
                secret={entry.id === 'google' ? undefined : statuses?.[entry.id]}
                onToggle={() => setExpanded(expanded === entry.id ? undefined : entry.id)}
                onMakeDefault={() => void makeDefault(entry.id)}
                onSecretsChanged={refresh}
                onDelete={() => remove(entry.id as CustomProviderId)}
              />
            </div>
          ))}
        </div>
      </section>

      <CacheSection />

      <AddServiceDialog
        open={adding}
        origin={addButton.current}
        existingIds={customIds}
        onClose={() => setAdding(false)}
        onAdded={(id, granted) => {
          setAdding(false);
          setExpanded(id);
          setFresh(id);
          refresh();
          notice.saved(granted ? '已添加' : '已添加，等待授权');
        }}
      />
    </>
  );
}
