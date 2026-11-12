# Easy Translate 最终方案（2026-11-13）

> 基线：`2026-11-13-fable-design-review.md` 评审结论 + 用户已拍板 4 项（默认 google 非官方端点、内容脚本 `<all_urls>`、截图分享简化后置、Biome）+ 该报告第 7 节核对意见 + 竞品调研。配套 UI 规范见 `2026-11-13-ui-ux-design.md`。范围不变：账户/订阅/Coco 只留扩展点；全部翻译能力优先完整交付。

## 1. 自我审查：核对意见逐条落地 + 新发现

**第 7 节五条意见全部吸收，无反驳：**

1. **配置写入改为后台单写入点 + 字段级 patch**。UI 永不提交整对象，只发 `config.patch(patches)`；后台串行执行「读最新 → 逐条合并 → zod 校验 → 整体写入」，`onChanged` 仍是唯一广播源。Popup 与 Options 并发修改互不覆盖。不恢复 revision。
2. **缓存键恢复语义完整性**。「prompt 版本」升级为 **promptDigest**：对最终构建出的 system+user 提示词（已注入专家风格与命中术语）取哈希；temperature 等采样参数归入 **paramsDigest**。MT 引擎两者为空串。术语按 URL 匹配导致的译文差异由 promptDigest 天然区分。
3. **取消与流式统一走 Port 长连接**。翻译族改用 `chrome.runtime.connect({name:'et-translate'})`：页面关闭/导航 → `onDisconnect` → 后台中止该 Port 名下全部在途任务；单条取消发 `{t:'cancel', reqId}` 帧。sendMessage 只保留给一次性请求-响应（config、platform 等）。Port 消息活动会刷新 SW idle 计时，顺带缓解 worker 回收问题。
4. **自定义 baseURL 用 optional_host_permissions**。manifest `host_permissions` 只列内置 provider 域名；`optional_host_permissions: ["https://*/*"]`，用户保存自定义端点时调用 `permissions.request`（需手势，保存按钮即是）。**M1 设实测门槛**：验证 content `<all_urls>` 是否已覆盖后台跨域 fetch，结论写入 M1 验收记录，不默认成立。
5. **批量合并升级为一等模块 BatchCodec**。职责：多段编号打包（MT 用分隔符、LLM 用 JSON 数组）、响应对齐校验、失败整批拆回逐条、每段独立写缓存。文章精翻的「分块 + 校验 + 降级」直接复用同一实现，只是块更大、带重写 prompt。

**自查新发现（本轮一并修正）：**

6. **content script 拆两层**：`core`（扫描/插入/还原/快捷键，vanilla TS，gzip ≤ 20KB，document_idle 注入）与 `ui`（React 组件，页面空闲后懒加载，≤ 70KB）。上一轮未约束注入体积，整包 React 进 content 会拖慢所有网页。CI 用 size-limit 卡死预算（详见 UI 规范 6.3）。
7. **语言检测三级回落**：Chrome 138+ 的 `LanguageDetector` API → `chrome.i18n.detectLanguage` → 轻量启发式。检测结果等于目标语言的段落跳过翻译（竞品标配，上一轮未明确）。
8. **AppError 收敛为 5 类**：`config | network | rate-limit | provider | validation`，加 `retryable` 标志；`aborted` 不算错误。9 类是过度分类。
9. **流式输出**：划词/输入/文章精翻走 Port 的 `chunk` 帧；整页翻译**不做**流式（布局抖动，见 UI 规范）。LLM 单段流式按 50ms 合批写 DOM。

## 2. 功能补漏（竞品调研结论）

调研对象：沉浸式翻译、DeepL、Google 官方扩展、Edge 内置、Kiss Translator、Read Frog。按价值/成本筛选后**纳入**：

| 功能 | 竞品 | 价值/成本 | 批次 | 取舍理由 |
|---|---|---|---|---|
| 按站点记忆（自动翻译/目标语/显示模式） | 沉浸式、Kiss、Read Frog、Edge | 高/低 | M2 | 核心体验，storage 一张 siteMemory 表；与站点规则同层 |
| 语言检测跳过目标语页面/段落 | 全部 | 高/低 | M1–M2 | 省请求省钱，必做 |
| Chrome 内置 Translator API 本地引擎 | Edge 内置、沉浸式 | 高/低中 | M3 | 免费、离线、隐私；定位**可选 provider**不做默认（质量低于 LLM）；`create()` 需用户手势 → 下载引导放 Options/Popup |
| 划词/输入面板流式输出 | 沉浸式、Read Frog | 中/低 | M3 | LLM 等待感的主要解法；Port 帧已支持 |
| 修饰键悬停译单段 | 沉浸式、Kiss、Read Frog | 高/低 | M3 | 原悬停设计明确为「Alt+悬停译该段」 |
| 仅译选中区域 | 沉浸式、Kiss | 中/低 | M3 | 复用划词管线 + 页面渲染器 |
| 划词卡片多引擎对比（并排 2 / 换引擎重译） | 沉浸式、Kiss | 中/中 | M4 | 只在卡片做；整页对比请求翻倍，不做 |
| 输入润色预设（DeepL Write 类） | DeepL | 中/低 | M4 | 是专家风格的一个 prompt 预设，近零成本 |
| 生词本 + CSV/Anki 导出 | Read Frog 等 | 中/中 | M5 | 与术语库共用存储与导出管线；**不做**复习算法 |
| 双语导出 Markdown/HTML | 沉浸式 | 中/低 | M5 | 绑定文章精翻与字幕阅读的「导出」按钮 |
| .srt/.vtt 字幕文件翻译 | 沉浸式 | 中/低 | M6 | 复用字幕分块 + BatchCodec，本地处理不上传 |

**刻意不做**（防臃肿）：PDF/EPUB 阅读器与版面还原（另一类产品，M8+ 单独评估 PDF）、漫画/图片 OCR、AI 字幕 ASR（需云服务，违背无账户）、整页流式渲染、整页多引擎并排、间隔重复背词系统、URL 参数快捷切换、AI 对话/总结。

**Translator API 事实边界**（调研核实）：Translator 与 LanguageDetector 自 Chrome 138 稳定版可用（扩展亦可），`translateStreaming` 支持流式；限桌面端；`create()` 需用户激活；语言对约 40 个且会变动；跨域 iframe 需显式授权；Prompt API（Gemini Nano）官方文档版本号自相矛盾，**不纳入依赖**。

## 3. 最终架构

运行环境与消息拓扑沿用上一轮（Background SW 统一调度 / content 注入 / MAIN world 仅字幕桥 / Options 直连测试），本轮修正三点：

- **content 分层**：`content/core`（无 React）+ `content/ui`（懒加载），见第 1 节第 6 条。
- **双通道消息**：`sendMessage`（@webext-core/messaging，5 消息族中的一次性调用）+ **翻译 Port**（流式/取消/会话生命周期）。页面翻译会话 = 一条 Port 连接，generation 概念随之消失。
- **存储**：`storage.local` 三键——`config`（后台单写入点 + 字段 patch）、`secrets`（密钥独立键，不随导出）、`siteMemory`（站点记忆表，content 可直读）；IndexedDB（idb）两库——翻译缓存（LRU 按字节 + TTL）、字幕/文章缓存；生词本并入 config 同层的独立键。
- **权限**：`storage, activeTab, contextMenus, commands` + content `<all_urls>` + `host_permissions`（内置 provider 域名）+ `optional_host_permissions: ["https://*/*"]`（自定义端点）。`tts/downloads/scripting` 随批次追加。
- **账户扩展点**（M8 前不实现）：`AuthState`（默认恒匿名）、`getTier()`（默认全放行）、provider 注册表可追加 coco。三处之外不预留任何账户代码。

## 4. 技术选型（增量）

沿用上一轮：Biome、zod v4、idb、Vitest + WxtVitest + fake-browser（DOM 用 happy-dom）、@webext-core/messaging、无状态库（`useConfig()` hook）、CSS Modules + createShadowRootUi、@wxt-dev/i18n（zh-CN/en）。本轮新增：

| 项 | 选择 | 理由 / 替代 |
|---|---|---|
| 流式与取消通道 | 自封装 `chrome.runtime.connect` Port 协议（约 100 行） | @webext-core/messaging 不覆盖流式/断连取消；不选 RxJS（杀鸡牛刀） |
| 体积门禁 | size-limit（CI） | 守住 content core ≤20KB 等预算；不选 bundlesize（维护弱） |
| 本地引擎 | Translator + LanguageDetector API | 免费离线兜底；不选 Bergamot/firefox-translations（WASM 体积大、需自托管模型） |
| 启发式检测回落 | tinyld（或等价轻量库） | 仅在两级 API 均不可用时使用 |

## 5. 模块目录

```
src/
├─ lib/                       # 纯逻辑，全部可单测
│  ├─ config/                 # schema.ts(zod) repository.ts(单写入点+patch) use-config.ts
│  ├─ messaging/              # protocol.ts(sendMessage 族) port.ts(翻译 Port 帧)
│  ├─ providers/              # types.ts registry.ts google.ts openai-compat.ts gemini.ts chrome-local.ts
│  ├─ translator/             # scheduler.ts batch-codec.ts cache.ts language.ts
│  ├─ glossary/               # match.ts(词边界) prompt-builder.ts(含 promptDigest)
│  ├─ vocab/                  # 生词本 + CSV/Anki 导出（M5）
│  └─ auth/                   # auth-state.ts（扩展点，默认匿名）
├─ content/
│  ├─ core/                   # scanner / renderer / restorer / session / site-memory（无 React）
│  └─ ui/                     # ball / selection-card / input-translate（React 懒加载）
├─ features/
│  ├─ subtitle/               # youtube/（桥+覆盖层） reader/（面板） article/（精翻，复用 batch-codec）
│  ├─ subtitle-file/          # .srt/.vtt 导入导出（M6）
│  ├─ tiktok/                 # M6
│  └─ capture/                # 简化截图（M7）
└─ entrypoints/               # background.ts content.ts popup/ options/（纯装配）
```

## 6. 核心接口（关键类型）

```ts
// providers/types.ts —— 函数式，无 class
export interface TranslateProvider {
  id: string
  kind: 'mt' | 'llm' | 'local'
  translateBatch(req: BatchRequest, ctx: ProviderCtx): AsyncIterable<BatchEvent>
}
export interface BatchRequest {
  items: { id: string; text: string }[]
  sourceLang: string | 'auto'
  targetLang: string
  prompt?: BuiltPrompt                    // LLM：已注入专家风格与命中术语
  params?: { model?: string; temperature?: number }
}
export type BatchEvent =
  | { type: 'chunk'; id: string; delta: string }
  | { type: 'done'; id: string; text: string; detectedLang?: string }
  | { type: 'error'; id: string; error: AppError }

// translator/cache.ts —— 缓存键（吸收意见 2）
// key = sha256(providerId ⊕ endpoint ⊕ model ⊕ sl ⊕ tl ⊕ promptDigest ⊕ paramsDigest ⊕ text)
// promptDigest = sha256(最终 system+user 提示词)；MT 引擎 promptDigest/paramsDigest = ''

// config/repository.ts —— 字段级 patch（吸收意见 1）
export type ConfigPatch = { path: ConfigPath; value: unknown }[]  // ConfigPath：类型安全点路径白名单
// 后台串行：readLatest → applyPatches → zod.parse → storage.local.set（失败整批拒绝并回错误）

// messaging/port.ts —— 翻译 Port 帧（吸收意见 3）
export type PortUp =
  | { t: 'enqueue'; reqId: string; batch: BatchRequest; scope: 'page' | 'selection' | 'input' | 'subtitle' | 'article' }
  | { t: 'cancel'; reqId?: string }       // 省略 reqId = 取消该 Port 全部在途
export type PortDown = { t: 'chunk' | 'done' | 'error'; reqId: string; payload: BatchEvent }
// background onDisconnect(port) → scheduler.cancelAll(port.id)

export interface AppError { kind: 'config' | 'network' | 'rate-limit' | 'provider' | 'validation'; message: string; retryable: boolean }

// auth/auth-state.ts —— M8 前唯一的账户代码
export interface AuthState { status: 'anonymous' }
export const getTier = (_s: AuthState) => 'unlimited' as const
```

## 7. 交付批次与验收门槛

| 批次 | 内容 | 验收门槛 |
|---|---|---|
| **M0 地基** | Biome、Vitest+WxtVitest、zod ConfigV1、config repository（单写入点+patch）、messaging+Port 协议、size-limit、CI | check/lint/test 全绿；**并发 patch 不丢更新**的单测；Port 断连清理单测 |
| **M1 翻译核心** | scheduler（并发/退避重试/取消/去重）、BatchCodec、google+OpenAI 兼容+gemini、idb 缓存（完整键）、语言检测三级回落、Options 服务页+直连测试、optional_host_permissions 流程 | 调度/编解码/缓存键单测；fake-browser 下 worker 重启场景通过；**实测并记录 `<all_urls>` 与后台 fetch 的权限结论**；自定义 baseURL 保存→授权→连通全链路手测 |
| **M2 整页翻译** | 扫描/分组/占位符保护、双语+仅译文、4 样式、懒翻译（视口优先）、完整还原、**按站点记忆**、宿主亮暗适配、Port 会话 | 10 站手测清单；还原无 DOM 残留；占位符丢失整块回退；关页后在途任务 ≤1s 中止；content core ≤20KB |
| **M3 交互/动态页/本地引擎** | 划词卡片（**流式**、固定、词典态）、悬浮球、**Alt+悬停译段**、**仅译选区**、右键菜单、commands、TTS、MutationObserver/SPA/iframe/Shadow DOM、**Chrome 内置 Translator provider** | 竞态清单（迟到丢弃/会话切换）通过；10 站无样式污染；内置引擎含语言包下载引导与无手势降级路径 |
| **M4 专家/术语/输入翻译** | 专家风格 CRUD、术语库（词边界匹配）、JSON/CSV 导入导出、输入翻译（⌥I 默认 + 3 连空格可选 + **润色预设**）、**卡片多引擎对比**、i18n zh/en、onboarding | 术语注入可见生效；导出不含密钥；IME 不误触；30 秒零配置首译达标（UI 规范 4.1） |
| **M5 字幕包** | YouTube 双语字幕（captionTracks 直取优先 + hook 回退 + 失效诊断）、字幕阅读面板、**文章精翻**（BYOK、分块流式、块级重试）、**生词本+CSV/Anki**、**双语导出 MD/HTML** | 精翻分块校验/降级路径单测；站点改版显式降级提示而非静默失败 |
| **M6 TikTok + 字幕文件** | TikTok 文稿面板；.srt/.vtt 导入翻译导出 | CDN 403/无字幕有用户可见提示；大字幕文件分块处理不卡 UI |
| **M7 可选打磨** | 简化截图分享、microsoft 等 provider、远程规则通道、Playwright E2E | 按需单独立项 |
| **M8 未定** | 账户（接入三扩展点，须服务端契约先行）；PDF 阅读页评估 | 届时另立设计 |

MVP = M0–M2；M0–M6 为承诺的完整翻译能力。

## 8. 风险

1. **google 非官方端点失效/合规**（中高）：一键切换 BYOK + **内置 Translator 作免费兜底**（本轮新增缓解），商店描述谨慎。
2. **YouTube/TikTok 逆向漂移**（高）：接口特征集中单文件便于热修；失效诊断 + 显式降级；必做但隔离为 feature 包。
3. **host 权限假设**（中）：M1 实测门槛兜底；若 `<all_urls>` 不覆盖后台 fetch，扩大 `host_permissions` 并接受审核成本。
4. **Translator API 限制**（中）：用户激活、语言对变动、仅桌面端；定位可选 provider，create 前引导手势，不可用时隐藏入口。
5. **SW 回收丢在途**（中）：Port 重连即重发未完成段；Port 消息刷新 idle 计时。
6. **流式写 DOM 性能**（低中）：50ms 合批；整页不流式。
7. **密钥明文存储**（低）：行业现状，文档明示。

## 附录：相对上一轮的变更清单

1. 配置写入：整对象「最后写入为准」→ 后台单写入点 + 字段级 patch（意见 1）。
2. 缓存键：6 字段 → promptDigest + paramsDigest 的 8 要素哈希（意见 2）。
3. 新增翻译 Port 长连接：承载流式、取消、会话生命周期；generation 概念移除（意见 3）。
4. 权限：新增 optional_host_permissions 流程与 M1 实测门槛（意见 4）。
5. BatchCodec 升为一等模块，整页批量与文章精翻共用（意见 5）。
6. content script 拆 core/ui 两层，size-limit 体积门禁进 CI（自查）。
7. 语言检测：启发式 → LanguageDetector API 三级回落；目标语跳过（自查+竞品）。
8. AppError 收敛为 5 类（自查）。
9. 新增功能：按站点记忆（M2）、流式划词/输入（M3）、Chrome 内置 Translator（M3）、仅译选区（M3）、卡片多引擎对比（M4）、润色预设（M4）、生词本+Anki（M5）、双语导出（M5）、字幕文件翻译（M6）。
10. 明确不做：PDF/EPUB 阅读器、漫画 OCR、ASR、整页流式、整页多引擎、间隔重复系统。
11. UI/UX 独立成规范（墨青纸感方向），性能预算与 30 秒首译纳入验收。
12. 用户拍板落地：Biome、content `<all_urls>`、google 默认引擎、截图简化后置（M7）。

## 待用户拍板（附推荐）

> **2026-11-13 已拍板**：本节 3 项和「主会话验收意见」中的待定项，全部按推荐执行，汇总见仓库根目录 `HANDOFF.md` 第 3 节。

1. **内置 Translator 的降级策略**：当默认引擎失败时是否自动切到本地引擎？推荐**不自动**（质量突降造成困惑），仅在错误 Toast 提供「改用本地引擎」一键切换。
2. **生词本是否进 M5**：推荐进（与术语库共用存储与导出管线，成本低）；若砍，M5 提前约一周。
3. **字幕阅读面板形态**：UI 规范已定为页内 Shadow DOM 面板而非 `chrome.sidePanel`（与播放器同步免跨进程、不占全局侧栏），如无异议照此执行。

## 主会话验收意见（第二轮）

1. **本地引擎不能运行在 Service Worker 中（需在 M3 前实测确认）**：Translator / LanguageDetector 这类内置 AI API 只在 Window 环境中提供，后台 SW 里大概率不可用。chrome-local provider 不能直接放进后台调度器，需要改成以下两种方式之一：在内容脚本或 offscreen document 中执行，或者由后台通过 Port 委托执行。语言检测三级回落中的第一级同样受此影响，因此后台只能使用 `chrome.i18n.detectLanguage`。
2. **默认快捷键与 macOS 的 Option 输入法冲突**：`⌥A/⌥S/⌥W/⌥I` 在 Mac 上会输出 å、ß、∑ 和 ˆ（ˆ 是死键）。commands 会在全局拦截这些组合键，导致德语、北欧语言等用户无法正常输入这些字符。`⌥I` 又恰好监听在输入框内，冲突最直接。建议改用 `⌥⇧` 组合或 `Ctrl+Shift` 组合，并在 M3 用真机验证。
3. **文章精翻的分块口径不一致**：最终方案写的是 50 句一块，UI 规范写的是约 800 token 一块。需要统一，建议按句数和 token 上限双重约束分块。此外，UI 规范把文章模式扩展到了「网页正文」，超出了最终方案的范围（最终方案中文章模式只针对字幕），需要用户拍板。
4. **去掉 generation 后仍需本地防串写**：同一个 Port 内，SPA 路由切换或中途切换引擎时，旧请求的结果可能晚到。内容脚本需要维护一个「当前有效的 reqId 集合」或本地 epoch，只接受属于当前会话的结果。
