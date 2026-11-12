# Easy Translate 交接文档（HANDOFF）

> 最后更新：2026-11-13 · 阶段：**规划完成，尚未开始实施（下一步 M0）**
> 本文给接手的 Agent 或开发者用，按顺序读完即可直接开工。文中凡与其他文档冲突的地方，以本文和「权威文档」为准。

## 1. 项目一句话

Easy Translate 是一个 Chrome MV3 网页翻译扩展，技术栈为 WXT 0.21 + React 19 + TypeScript strict + Vite 8 + CSS Modules。它是独立的新扩展，不读取、也不迁移任何旧扩展的数据。

## 2. 文档地位（先读这里）

| 文档 | 地位 | 用法 |
| --- | --- | --- |
| `HANDOFF.md`（本文） | **最高优先**：进度、已拍板决策、下一步 | 开工前必读 |
| `docs/reviews/2026-11-13-final-plan.md` | **权威技术方案**：架构、选型、目录、核心接口、M0–M8 批次与验收、风险，文末附验收意见 | 实施依据 |
| `docs/reviews/2026-11-13-ui-ux-design.md` | **权威 UI/UX 规范**：「墨青纸感」、设计 token、各界面与状态、流程、克制清单、性能预算 | 所有 UI 实现的依据 |
| `docs/reviews/2026-11-13-fable-design-review.md` | 第一轮评审，说明为何偏离旧方案 | 需要了解取舍理由时读 |
| `docs/design/00–15`、`reference/*.json` | **旧方案，降级为功能参考**：用户可感知的行为细节、站点规则、字幕协议等 | 实现某个功能时查细节；架构、协议、配置写法与权威文档冲突的部分一律不采用 |
| `DESIGN.md` | **已过时**（骨架期的绿色主题临时规范），由 UI/UX 规范取代 | M0 中替换或删除 |
| `README.md` | 开发命令与项目结构 | 结构变化后同步更新 |
| `CHANGELOG.md` | 功能迭代记录 | 每完成一个批次或一项用户可感知的改动，就在「未发布」下追加条目 |

## 3. 已拍板决策（2026-11-13，用户确认）

**范围**
- 账户、登录、订阅/会员、短码、Coco 等依赖账户的服务端接口**暂不做**。只保留 3 个扩展点：`AuthState`（恒为匿名）、`getTier()`（全部放行）、provider 注册表。这 3 处之外不写任何账户代码，放到 M8 视情况再定。
- **文章精翻必做**，基于用户自己配置的 AI 供应商（BYOK），不依赖账户。**范围仅限字幕**，网页正文的文章模式以后再评估。
- 优先级：先把全部翻译能力做完整（M0–M6），可选打磨放到 M7，账户放到 M8。

**技术与产品**
| 事项 | 决定 |
| --- | --- |
| 默认翻译引擎 | Google 非官方端点（零配置），设置中可一键切换为 BYOK |
| 内容脚本注入 | `<all_urls>` 静态注入 |
| lint/format | Biome 2 |
| 截图分享 | 只做简化版，放在 M7 |
| 默认引擎失败时 | **不自动**降级到本地引擎，只在错误提示中提供一键切换 |
| 生词本 | 放进 M5，与术语库共用存储和导出管线 |
| 字幕阅读面板 | 页内 Shadow DOM 面板，不用 `chrome.sidePanel` |
| 文章精翻分块 | **句数和 token 双上限**（约 50 句 / 约 800 token，先达到哪个就按哪个切），块并发 2，失败的块降级为逐句翻译 |
| 默认快捷键 | **不用 Option 组合**：macOS 上 `⌥X` 和 `⌥⇧X` 都会输出字符（å、ß、Å 等），影响德语、北欧语言等用户的输入。改用 `Ctrl+Shift+字母`（macOS 上为 `⌃⇧`，在 manifest 中写 `MacCtrl+Shift+…`）。具体字母在 M3 用真机排查冲突后确定。UI 规范 4.4 节的 `⌥A/⌥W/⌥S/⌥R/⌥I` 作废 |
| 内容脚本防串写 | 去掉协议层的 generation 后，内容脚本仍要维护「当前有效的 reqId 集合」或本地 epoch，只接受属于当前会话的结果 |

## 4. 当前代码状态

- **已有**：约 400 行骨架，包括 popup（检查当前页面）、options（目标语言和显示模式两项设置）、background（返回状态）、content（返回页面标题和语言）、`src/lib/messages.ts`、`src/lib/settings.ts`。
- **可用命令**：`npm run dev | build | check | typecheck | zip`。截至 2026-11-13，`npm run check` 通过。
- **还没有**：测试框架、lint、schema 校验、任何翻译能力。
- **git**：分支 `main`。规划文档（`docs/reviews/`、本文、`CHANGELOG.md`）已于 2026-11-13 提交并推送。
- **骨架代码将被重构**：`settings.ts` 迁移到 config repository；`messages.ts` 迁移到 `lib/messaging`；popup 和 options 按 UI 规范重做。不必保留现有的实现方式。

## 5. 下一步：M0 地基（验收标准见 final-plan 第 7 节）

建议顺序，每一步都应能独立验证：
1. **工具链**：引入 Biome 2（`biome.json`，加 `lint`/`format` 脚本），引入 Vitest + `WxtVitest`（wxt/testing）+ `@webext-core/fake-browser` + happy-dom（加 `test` 脚本）。
2. **依赖**：zod v4、idb、`@webext-core/messaging`。
3. **配置**：在 `src/lib/config/` 下建立 `schema.ts`（zod ConfigV1）、`repository.ts`（后台单写入点：串行执行「读最新 → 字段 patch → zod 校验 → 写入」，`onChanged` 广播）、`use-config.ts`。必须有「并发 patch 不丢更新」的单测。
4. **消息**：`src/lib/messaging/protocol.ts`（一次性调用的 5 个消息族），以及 `port.ts`（翻译 Port 帧：enqueue/cancel/chunk/done/error；`onDisconnect` 时取消该连接名下的全部任务）。必须有断连清理的单测。
5. **体积门禁**：size-limit，预算见 UI 规范 6.3 节（content core ≤20KB gzip）。
6. **CI**：GitHub Actions 运行 check、lint、test、size。复杂逻辑写在 Node 脚本里，不要写成长串 Bash。
7. **设计 token**：把 UI 规范第 2 节的 token 落到 `src/styles/`（TS 单一来源，同时生成 `:root` 与 `:host` 两份），用它替换 `DESIGN.md` 的旧主题，并让 popup/options 接入新的 config。

M0 完成后依次进入 M1（翻译核心）和 M2（整页翻译），二者合起来就是 MVP。

## 6. 需要实测确认的假设（不要默认成立）

| 假设 | 何时验证 | 不成立时的处理 |
| --- | --- | --- |
| 内容脚本的 `<all_urls>` 能让后台跨域 fetch | M1 | 扩大 `host_permissions` |
| Translator / LanguageDetector API 在 Service Worker 中**不可用** | M3 前 | 本地引擎放到内容脚本或 offscreen document 执行，后台语言检测只用 `chrome.i18n.detectLanguage` |
| Port 消息能刷新 SW 的 idle 计时 | M1 | 内容脚本断线后重连并重发未完成的段落 |
| YouTube 的 `captionTracks` 能直接取到字幕 | M5 | 回退到 hook 网络请求，并给出失效诊断提示 |

## 7. 协作约定（来自用户的全局偏好）

- 回复、文档、Todo 一律用**简体中文**。
- **写代码前先描述方案，等用户批准后再动手**；需求模糊时先问清楚。
- 风格：React + TS，**不用 class**，优先具名 import（`import { x } from 'y'`）。
- 每完成一项任务都要跑通 `npm run check`，引入 Biome 和 Vitest 后还要跑 lint 和 test，修完问题再总结。
- 控制 token 成本：大批量阅读和实现交给子代理；主 Agent 负责拆解、分发和验收。
- 每完成一项任务：更新 `CHANGELOG.md`，并在本文「进度日志」中追加一行。
- 未经用户要求，不提交（commit）、不推送（push）。

## 8. 进度日志

| 日期 | 事项 |
| --- | --- |
| 2026-11-13 | 熟悉骨架与旧方案；Fable 5.2 完成两轮评审，产出最终方案和 UI/UX 规范；用户拍板全部决策（见第 3 节）；暂不做高保真设计稿；创建本文和 `CHANGELOG.md`，提交并推送到 main。下一步：M0 |
