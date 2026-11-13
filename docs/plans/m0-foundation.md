# M0 地基：技术方案

> 状态：**已实现，待合并**（已吸收独立审查的 2 条阻断、5 条重要、6 条建议） · 2026-11-13 · 依据：`HANDOFF.md` 第 3/5/6/8 节、`docs/reviews/2026-11-13-final-plan.md`、`docs/reviews/2026-11-13-ui-ux-design.md` 第 2 节与 6.3 节
> 分支：`feat/m0-foundation` · 交付方式：1 个 PR（内部按主题拆提交），CI 通过后由用户手动合并

## 1. 目标与完成标准

M0 不交付翻译能力，只交付后续所有批次都依赖的五样东西：**质量门禁、配置仓库、消息协议、Port 传输层、设计 token**。完成后系统仍然可用：弹窗和设置页功能等同骨架，但已经跑在新的基础设施上。

完成标准（全部满足才算 M0 完成）：
1. 本地 `npm run check` 一条命令依次跑通：Biome、类型检查、单元测试、生产构建、manifest 校验、体积预算。
2. GitHub Actions 在 PR 上运行同一套检查，结果为绿。
3. 设置页修改配置后，弹窗无需刷新即可反映；并发修改不同字段互不覆盖；Service Worker 被停止后修改仍能生效。
4. 第 8 节列出的单元测试全部存在并通过。
5. README、HANDOFF、CHANGELOG 与代码一致；`DESIGN.md` 改为指向 UI/UX 规范。

## 2. 不做的事

- 任何翻译、Provider、调度、缓存（M1）。
- 页面 DOM 引擎和 happy-dom 环境（M2 才有 DOM 逻辑需要测试）。
- 按 UI 规范重做弹窗信息结构，比如「翻译此页」主按钮：现在做会展示尚不可用的能力，违反 UI 规范的克制原则。M0 只换上新 token 和主题。
- 旧 `settings` 存储键的迁移：骨架从未发布，开发数据直接作废。
- 配置迁移框架：在第一次出现破坏性 schema 变更时再加，见 4.2。
- E2E 测试（M7）、i18n 框架（M4）、Port 在后台的业务注册（M1）。

## 3. 总体结构

```
扩展页面 (popup / options)          内容脚本                  Background SW
 useConfig ─┐                     readConfig/watch            ConfigRepository（唯一写入点）
            ├─ readConfig ──────────────┐                       ▲ 串行队列：读最新→patch→zod 校验→写
            ├─ watchConfig ◀── storage.onChanged ◀──────────── storage.local["config"]
            └─ patchConfig ── messaging('config.patch') ──────▶ handler → Result<Snapshot>
popup ── messaging('page.getInfo', tabId) ───────▶ content handler
（M1 起）content ── Port('et-translate') 帧 ─────────▶ Port 服务端（AbortController / 请求）
```

数据只有一个流向：**写入一律经后台，读取和订阅直接走 storage**。图中没有环。

## 4. 关键设计

### 4.1 质量门禁与工具链

| 项 | 方案 |
| --- | --- |
| Biome 2.6 | `biome.json`：格式化使用 2 空格、单引号、分号、行宽 100（与现有代码风格一致）；linter 使用 `recommended` 加 `domains.react: "recommended"`；检查 `src/`、`scripts/` 和根目录配置文件，排除 `.output`、`.wxt`、`docs`。`*.module.css` 自动启用 CSS Modules 解析。 |
| 脚本 | `lint` 对应 `biome ci .`（只检查）；`format` 对应 `biome check --write .`；`test` 对应 `vitest run`；`test:watch`；`check` 依次执行 lint、typecheck、test、build、`check-build.mjs`、`check-size.mjs` |
| Vitest 5 | `vitest.config.ts` 使用 `WxtVitest()`（来自 `wxt/testing/vitest-plugin`）。环境为 node，`include: src/**/*.test.ts`；setup 文件在每个用例前执行 `fakeBrowser.reset()`（来自 `wxt/testing/fake-browser`）。测试文件与源码同目录放置。 |
| 体积门禁 | **新增 `scripts/check-size.mjs`，零依赖**：用 Node `zlib.gzipSync` 计算构建产物的 gzip 体积。content 与 background 按单文件计算；popup 和 options 按页面计算，即把 HTML 中 `script src` 与 `modulepreload` 引用的全部 JS 求和，包括共享 chunk。预算：content ≤ 20KB、background ≤ 60KB（后台不影响网页性能，需要给 zod 和后续的 provider 留余量）、popup ≤ 80KB、options ≤ 150KB。超标，或者找不到入口文件时，都以非零码退出（不能静默通过），并打印明细。 |
| CI | `.github/workflows/ci.yml`：在 `pull_request` 和 push 到 `main` 时触发；`permissions: contents: read`；按分支设置 `concurrency` 并取消旧的运行。步骤：checkout → `setup-node`（读取 `.nvmrc`，开启 npm 缓存）→ `npm ci` → lint → typecheck → test → build → check-build → check-size。每一步都是单条 npm 命令，不写 Bash 逻辑。 |
| 首个提交 | 单独提交一次 Biome 全量格式化（`style: apply biome formatting`），避免格式化改动和逻辑改动混在一起。 |

### 4.2 配置（`src/lib/config/`）

**Schema 只放有消费者的字段**。M0 的 ConfigV1 如下：

```ts
interface ConfigV1 {
  ui: { theme: 'system' | 'light' | 'dark' }        // 消费者：popup / options 主题
  language: { target: LanguageCode }                  // 消费者：popup 展示、options 设置；M1 起用于翻译
}
```

后续批次新增的字段，都在 schema 里带默认值追加，例如 M1 加 `language.source` 和 provider，M2 加 `display`。**追加字段不升版本**：读取时缺失的字段会自动补上默认值。只有删除字段、改名或改语义这类破坏性改动，才把 `schemaVersion` 加 1，并在当批引入迁移函数。

**存储格式**：`storage.local` 的 `config` 键，值为 `{ schemaVersion: 1, data: ConfigV1 }`。

**语言表**：`src/lib/languages.ts` 导出 `LANGUAGES`（code 与本地名称），M0 沿用骨架的 5 种：zh-CN、zh-TW、en、ja、ko，以及 `normalizeLanguage(tag)`，作用是把 `_` 统一成 `-`、处理大小写、映射到受支持的代码，无法映射时返回 undefined。默认目标语言 = `normalizeLanguage(chrome.i18n.getUILanguage())`，未命中时用 `en`。

**宽松读取 `parseStoredConfig(raw)`**（只在后台运行，**每次读取都重新判定，不缓存结果**）：
1. 缺失或不是对象：返回默认值，标记 `repaired`。
2. `schemaVersion` 大于当前版本（降级安装）：在内存中使用默认值，**进入只读模式**。只读模式下 patch 和 reset 都返回 `config/newer-version`，load 也不回写，不会覆盖较新的数据。
3. 正常情况：先把默认值深合并进原值，再用 zod `safeParse`。每个 issue 按下面的规则处理，最终标记 `repaired`，并附带被重置的路径列表：
   - **叶子非法**：只把这个叶子重置为默认值。
   - **父节点类型错误**（例如 `ui: "x"`）：整棵子树改用默认值。
   - **数组元素非法**：只剔除该元素，保留其余元素（M4 的专家风格列表依赖这一点）。
   - **issue 路径为根**：整体使用默认值。
   - 最多修复 5 轮；5 轮后仍然非法，整体回退为默认值，并标记 `fallback: true`。这是唯一会整体回退的终态，并且会记录日志。
4. **保留未知键**：对象层使用 `z.looseObject`。原因是切换开发分支或降级安装时，较新版本追加的字段不会被静默删除。代价是拼错的键不会被自动清理，可以接受。

**ConfigRepository**（`repository.ts`，只在后台）：

```ts
type ConfigPath = 'ui.theme' | 'language.target'            // 由 ConfigV1 类型推导的点路径联合，路径到数组或 Record 为止（不再深入），整体替换
type ConfigChange = { [P in ConfigPath]: { path: P; value: PathValue<ConfigV1, P> } }[ConfigPath]
interface ConfigSnapshot { schemaVersion: 1; data: ConfigV1 }

createConfigRepository(deps: { store: KeyValueStore; uiLanguage: string }): {
  load(): Promise<ConfigSnapshot>     // 读取并宽松解析；repaired 时回写一次
  patch(changes: ConfigChange[]): Promise<ConfigSnapshot>
  reset(paths?: ConfigPath[]): Promise<ConfigSnapshot>
}
```

- **串行队列**：所有会写 store 的操作（**包括 load 的修复回写**、patch 和 reset）都串在同一条 Promise 链上，单个操作失败不会打断后续操作。这样可以覆盖最常见的竞态：SW 被一条 patch 唤醒时，顶层 load 与这条 patch 同时到达。
- 每次 patch 都按以下顺序执行：从 store **读最新值** → **`parseStoredConfig` 宽松修复**（这样存量数据缺少新字段，或某个无关字段损坏时，都不会让保存失败）→ 检查只读模式 → 运行时校验 path 是否在白名单内 → 按路径赋值（数组和 Record 整体替换）→ 用 **zod 严格校验**整个对象 → 一次 `set` 写入。任何一步失败，store 都保持不变，并返回错误。
- **路径白名单从 zod schema 推导**：递归遍历 schema 的对象形状，遇到叶子、数组或 Record 就停止，不手工维护。另有一个类型测试，断言运行时白名单与 `ConfigPath` 类型完全一致，防止两者漂移。
- `KeyValueStore` 是一个 `{ get(key), set(key, value) }` 接口：生产环境用 WXT `storage` 实现，测试中可以注入一个会失败的实现。
- 广播完全依赖 `storage.onChanged`，仓库本身不做任何推送。

**客户端**（`client.ts`，供页面和内容脚本使用，**不引入 zod**）：
- `readConfig()`：读取 storage，先检查 `schemaVersion`，版本更高或缺失时使用默认值；再与默认值做结构合并，并对枚举字段做轻量守卫（值不在允许集合中就取默认值）。这里不引入 zod，依据是单写入点保证写入的数据已经合法，这层守卫只用于兜底版本差异，内容脚本因此省掉 zod 的体积。
- `watchConfig(cb)`：基于 WXT `storage.watch('local:config')`，返回取消订阅的函数。
- `patchConfig(changes)`、`resetConfig(paths?)`：经消息发给后台，返回 `Result`。

**`useConfig()`**（`use-config.ts`）：基于 `useSyncExternalStore` 和模块级 store，状态为 `loading | ready | error`，并暴露 `patch`。store 的订阅逻辑不依赖 React，单元测试只测 store，hook 本身只是一层薄包装。`getSnapshot` 只在内容变化时返回新对象，其余时候返回同一个引用；这一点有单测覆盖。**UI 不维护乐观状态**：控件的值始终来自 storage 快照，修改只发 patch，再由 watch 推回新值。这样快速连续修改时也不会出现回滚互相打架的问题。

### 4.3 消息协议（`src/lib/messaging/`）

使用 `@webext-core/messaging` 4.x 的 `defineExtensionMessaging<ProtocolMap>()`。它直接调用 chrome API，不依赖 polyfill，gzip 后约 0.6KB。

```ts
interface ProtocolMap {
  'app.getStatus'(): Result<{ version: string }>
  'config.patch'(changes: ConfigChange[]): Result<ConfigSnapshot>
  'config.reset'(paths?: ConfigPath[]): Result<ConfigSnapshot>
  'page.getInfo'(): Result<PageInfo>                     // popup → 指定 tab 的顶层帧（frameId: 0），发送前保留 http(s) 预检
}
type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }
```

- **返回值统一为 `Result`，handler 不向外抛错**。原因：错误跨上下文序列化依赖库的内部实现，用显式结构更确定，也方便类型收窄。`handle(fn)` 负责把 handler 中的异常归一化为 `AppError`。客户端的 `call()` 再把消息层自身的失败（例如 SW 或内容脚本不可达）也归一化为 `Result`。
- **内部消息不做 zod 校验**：发送方都是本扩展自己的代码。真正需要校验的信任边界是写入配置（由仓库的 zod 把关），以及 M5 的页面世界桥。
- 消息族按需添加；M0 只定义上面 4 个。

### 4.4 错误模型（`src/lib/errors.ts`）

```ts
type ErrorKind = 'config' | 'network' | 'rate-limit' | 'provider' | 'validation' | 'internal'
interface AppError {
  kind: ErrorKind
  code: `${ErrorKind}/${string}`   // 稳定代码，例如 'config/invalid-value'、'network/page-unreachable'，供将来 i18n 映射文案
  message: string                  // 开发者可读的说明，不直接展示给用户，也不写入密钥或原文
  retryable: boolean
  retryAfterMs?: number            // 供 M1 的退避使用（例如 429 的 Retry-After）
}
appError(kind, code, message, { retryable? }): AppError
toAppError(unknown): AppError     // 未知异常 → internal
```

用纯对象和工厂函数，不用 class。在最终方案 5 类的基础上**增加 `internal`**，用于承接意外异常；同时增加 `code`，作为文案映射的稳定键。取消不算错误（见 4.5）。

### 4.5 翻译 Port 传输层（`src/lib/messaging/port.ts`）

M0 只交付**与业务无关的传输层**和测试；后台在 M1 注册具体的翻译处理函数。

```ts
interface PortLike {                       // chrome.runtime.Port 的最小子集，便于注入内存实现做测试
  postMessage(msg: unknown): void
  onMessage: { addListener(cb: (msg: unknown) => void): void }
  onDisconnect: { addListener(cb: () => void): void }
  disconnect(): void
}
type Up<P>   = { t: 'req'; id: string; payload: P } | { t: 'cancel'; id?: string } | { t: 'ping' }
type Down<C, D> = { t: 'chunk'; id: string; data: C } | { t: 'done'; id: string; data: D } | { t: 'error'; id: string; error: AppError }
type Outcome<D> = { status: 'done'; data: D } | { status: 'error'; error: AppError } | { status: 'cancelled' }

servePort<P, C, D>(port, handler: (payload: P, ctx: { signal: AbortSignal; emit(chunk: C): void }) => Promise<D>): void
listenPort<P, C, D>(name: string, handler): () => void   // 后台顶层同步调用：onConnect 按 name 过滤后交给 servePort
createPortClient<P, C, D>(connect: () => PortLike): {
  request(payload: P, onChunk?: (c: C) => void): { id: string; outcome: Promise<Outcome<D>>; cancel(): void }
  cancelAll(): void
  dispose(): void
}
```

- **服务端**：每个请求对应一个 `AbortController`。收到 `cancel` 时中止单个请求，不带 id 的 `cancel` 中止全部请求。**`onDisconnect` 时中止该 Port 名下的全部请求。** 已中止请求的后续 `emit` 和最终结果一律不再发出。
- **客户端**：
  - 首次调用 `request` 时才建立连接。请求 id 用 `crypto.randomUUID()` 生成，不随重连重置。
  - 断连时，所有在途请求以 `{ status: 'error', error: network/port-disconnected, retryable: true }` 结束，下次请求自动重连。是否重试由调用方（M1 的调度器）决定。
  - **区分扩展上下文失效**：扩展被重载或更新后，`connect()` 和 `postMessage` 会抛出 context invalidated 错误。此时归为 `internal/context-invalidated`，并且**不可重试**，避免 M1 的调度器无限重试。
  - 所有 `postMessage` 都包在 try/catch 中。向已断开的 Port 发帧会同步抛错，此时按断连处理。
  - `cancel()` 和 `cancelAll()` 在本地立即以 `cancelled` 结束请求，并通知服务端；结束后该请求的 `onChunk` 不会再被调用。`dispose()` 把在途请求全部以 `cancelled` 结束，然后断开连接。本地主动 `disconnect()` 不会触发本端的 onDisconnect，所以必须自己收尾，否则在途 Promise 会永远悬挂。
  - **迟到帧**：未登记或已结束的 id 收到帧时直接丢弃。
- **防串写契约（写给 M2/M3 的调用方）**：调用方每次切换会话时，都必须先对旧会话执行 `cancelAll()`，例如 SPA 路由切换、切换引擎或停止整页翻译。在这个前提下，「丢弃已结束 id 的帧」就足以防止旧结果覆盖新结果，不需要额外的 epoch 计数。
- **保活**：Chrome 114 起，通过 Port 发送消息会重置 SW 的空闲计时，但仅仅保持 Port 连接不会让 SW 保活。因此有在途请求时，客户端每 20 秒发一次 `ping`，覆盖 LLM 长时间没有任何帧往来的情况。即便如此，「断连 → 结束请求 → 由调用方重试」仍然是必须走通的正常路径，不是边缘情况。

### 4.6 设计 token 与主题（`src/styles/`）

- **`tokens.css` 是唯一来源**：一个纯 CSS 文件，选择器写成 `:root, :host`，同时适用于扩展页面和 M2 起的 Shadow DOM，因此不需要 TS 生成步骤。内容完全照搬 UI 规范第 2 节的色彩、字号、间距、圆角、阴影和动效 token。**尺寸类 token 一律用 px**：注入到网页的 UI 如果用 rem，会受宿主页面 `html` 字号影响而失控。
- 暗色有三种生效方式：`[data-et-theme="dark"]`；`@media (prefers-color-scheme: dark)` 下的 `:root:not([data-et-theme="light"])`；以及 `:host` 的对应写法。
- `theme.ts` 提供 `applyTheme(theme)`，在 `<html>` 上设置或清除 `data-et-theme`。popup 和 options 通过 `useConfig` 驱动主题。
- `ui.module.css` 改为全部引用 `--et-*` 变量，去掉硬编码颜色；`DESIGN.md` 改写为一行指向 UI/UX 规范的说明。

### 4.7 入口迁移

| 文件 | 改动 |
| --- | --- |
| `background.ts` | 在顶层同步注册消息 handler（app.getStatus、config.patch、config.reset），然后执行 `repo.load()`。load 的回写同样进入串行队列，所以和同时到达的 patch 不会冲突。`onInstalled` 时同样执行 `load`，用来写入默认值。 |
| `content.ts` | 用新协议注册 `page.getInfo`，返回 `Result`。 |
| `popup/App.tsx` | 用 `useConfig` 展示目标语言、应用主题；保留「检查当前页面」，并按 `Result` 展示错误。 |
| `options/App.tsx` | 去掉「保存」按钮，改为**选择即保存**：控件的值来自配置快照，修改时调用 `patch`，成功后显示行内「已保存」，2 秒后消失；失败时提示错误，控件自然保持快照中的值，不需要专门的回滚逻辑。提供目标语言和界面主题（跟随系统/亮/暗）两项。 |
| `SettingsFields.tsx` | 按新 schema 重写。 |
| 删除 | `src/lib/settings.ts`、`src/lib/messages.ts` |

## 5. 新增依赖

| 包 | 用途 | 进入哪些产物 |
| --- | --- | --- |
| `zod` ^4.6 | 后台配置校验 | 仅 background |
| `@webext-core/messaging` ^4.0 | 类型化消息 | 全部入口（约 0.6KB） |
| `@biomejs/biome` ^2.6（dev） | lint 与格式化 | 无 |
| `vitest` ^5.1（dev） | 单元测试 | 无 |

不新增：size-limit（改用自写脚本）、happy-dom（推迟到 M2）、idb（推迟到 M1，因为缓存才是它的第一个消费者）、Testing Library（hook 只是薄包装，store 单测即可覆盖）。

## 6. 相对 HANDOFF 和最终方案的偏离（需要批准）

1. **size-limit 改为零依赖脚本**：size-limit 的默认压缩算法和 glob 语义未能核实，而自写脚本只有约 40 行、完全可控，`scripts/` 里也已有 `check-build.mjs` 可以参照。
2. **token 用单个 CSS 文件**，不走「TS 生成两份」：`:root, :host` 一个选择器就能覆盖两种场景，省掉一个构建步骤。
3. **schema 只放有消费者的字段**：后续字段按批次追加，迁移框架在第一次破坏性变更时再引入。
4. **客户端读取不经过 zod**：zod 只打进 background，内容脚本更小。
5. **消息返回 `Result`**；AppError 增加 `internal` 类别和 `code` 字段。
6. **happy-dom 和 idb 推迟**到第一个真正用到它们的批次。
7. **Port 只交付传输层**，后台业务注册放到 M1。

## 7. 风险与前提

- **前提 A**：`@webext-core/messaging` 在 Vitest 的 fake browser 中可能无法完整模拟跨上下文消息。**应对**：handler 都写成纯函数，直接调用测试；协议的接线很薄，由构建和手工验收覆盖。不把测试的可行性押在 fake browser 对消息的模拟上。
- **前提 B**：fake browser 的 `storage.local` 支持 get、set 和 onChanged。WXT 官方测试方案就是基于它，风险低。万一不支持，仓库层通过 `KeyValueStore` 注入内存实现即可，设计上不需要改动。
- **前提 C**：GitHub 仓库已开启 Actions。如果第一次 PR 没有触发 CI，需要用户在仓库设置中开启。
- **回滚**：所有改动都在分支上，存储键从 `settings` 换成 `config`，只影响开发数据。回退 PR 即可恢复到骨架，不涉及外部状态。
- **规模**：约 30 个文件（新增约 20 个，修改或删除约 10 个），超过 8 个，在此明确说明。没有新服务，不需要任何凭据。

## 8. 测试清单

| 文件 | 用例 |
| --- | --- |
| `languages.test.ts` | `zh_cn`、`ZH-cn`、`en-US`→`en`、`ja-JP`→`ja`、未知语言返回 undefined；默认目标语言回退到 en |
| `config/parse.test.ts` | 缺失或非对象时返回默认值并标记 repaired；未知键被保留；单个叶子非法时只重置该叶子，其余保留；多个叶子非法；父节点类型错误时整棵子树用默认值；根路径 issue；数组元素非法时只剔除该元素；5 轮修复后仍非法时整体回退并标记 fallback；`schemaVersion` 更高时进入只读模式；合法数据原样保留且不标记 repaired |
| `config/paths.test.ts` | 按路径取值和赋值；数组和 Record 整体替换；非白名单路径被拒绝；**运行时白名单与 `ConfigPath` 类型一致**（类型测试） |
| `config/repository.test.ts` | 首次 load 写入默认值；**两个并发 patch 修改不同字段，结果都保留**；**load 的回写与同时到达的 patch 并发时，patch 不丢**；**存量数据缺少字段或有无关字段损坏时，patch 仍能成功**；非法值被拒绝，store 不变；store.set 失败时返回错误、store 不变，且后续 patch 仍可执行；reset 单个路径和全部路径；新建仓库实例（模拟 SW 重启）能读到上次写入的值；只读模式下 patch 和 reset 被拒绝，load 不回写 |
| `config/client.test.ts` | readConfig 合并默认值；版本更高或枚举值非法时取默认值；watch 在 config 变化时触发，其他键变化时不触发；取消订阅后不再触发 |
| `config/store.test.ts` | useConfig 背后的 store 依次经历 loading、ready、外部变更推送、读取失败进入 error 状态；内容未变化时 `getSnapshot` 返回同一个引用 |
| `messaging/handle.test.ts` | handler 正常返回 ok；抛出 AppError 时原样透传；抛出未知异常时归为 internal；`call()` 在对端不可达时归一化为 `Result`，而不是抛错 |
| `errors.test.ts` | toAppError 对 Error、字符串、AppError 形状对象、null 的处理 |
| `messaging/port.test.ts`（内存 PortLike） | req→chunk→done 正常流程；error 帧；handler 抛出非 AppError 时归为 internal；取消单个请求时服务端 signal 被中止，其余请求不受影响；cancelAll；取消后 onChunk 不再被调用；**断连时服务端中止全部请求、客户端以 retryable 错误结束全部请求，下次请求自动重连**；**dispose 后在途请求以 cancelled 结束，不会悬挂**；向已断开的 Port 发帧时按断连处理；connect 抛出 context invalidated 时归为不可重试；已取消或未知 id 的迟到帧被丢弃；重复 id 的请求被拒绝；handler 在中止后才完成时不再发帧；有在途请求时按 20 秒间隔发送 ping，空闲时不发 |

## 9. 手工验收（`npm run dev` 加载扩展）

1. 首次安装后，`chrome.storage.local` 中出现 `config`，目标语言符合浏览器 UI 语言。
2. 设置页切换主题和目标语言，弹窗无需刷新就能同步。
3. 同时打开设置页和弹窗，分别修改两个字段，两处修改都保留。
4. 在 `chrome://serviceworker-internals` 中停止 SW 后修改设置，修改仍然成功。
5. 在 `chrome://` 等受限页面点击「检查当前页面」，显示明确的错误。
6. 亮、暗、跟随系统三种主题下，弹窗和设置页的对比度都正常。

## 10. 提交与交付

提交按以下顺序拆分：
1. `chore: add biome, vitest and ci`
2. `style: apply biome formatting`
3. `feat(config): repository, client and useConfig`
4. `feat(messaging): typed protocol and port transport`
5. `feat(ui): design tokens and theme`
6. `docs: update for M0`

推送后开 PR，等 CI 通过后由用户手动合并。合并后，HANDOFF 的进度日志记为「M0 完成」，下一步进入 M1。
