# Easy Translate 交接文档（HANDOFF）

> 最后更新：2026-11-14 · 阶段：**M1 翻译核心暂停中**（分支 `feat/m1-translation-core`，未推送）：后台能力已完成并通过 Deep 审查，剩 3b（设置页 UI）未做
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

- **M0 地基已实现，待审查和合并**（分支 `feat/m0-foundation`，6 个提交，尚未推送）。实现依据为 `docs/plans/m0-foundation.md`。
  - 质量门禁：`biome.json`、`vitest.config.ts`（WxtVitest + fake browser）、`scripts/check-size.mjs`、`.github/workflows/ci.yml`。
  - 配置：`src/lib/config/`（ConfigV1 = `ui.theme` + `language.target`，存于 `storage.local["config"]`；后台 `repository.ts` 为唯一写入点；页面用 `client.ts`、`useConfig`）。
  - 消息：`src/lib/messaging/protocol.ts`（app.getStatus、config.patch、config.reset、page.getInfo，均返回 `Result`）、`handle.ts`、`port.ts`（只有传输层，后台业务注册在 M1）。
  - 设计 token：`src/styles/tokens.css`、`theme.ts`；popup/options 已接入新配置和主题，信息结构未按 UI 规范重做（避免展示尚不可用的能力）。
  - 已删除 `src/lib/settings.ts`、`src/lib/messages.ts`；显示模式设置移除，M2 重新加入。
- **可用命令**：`npm run dev | build | lint | format | typecheck | test | check | zip`。截至 2026-11-13，`npm run check` 通过（83 个单元测试）。
- **还没有**：任何翻译能力；方案第 9 节的手工验收（真实 Chrome）尚未执行；CI 尚未在 GitHub 上首次运行。
- **git**：`main` 上是规划文档；M0 在 `feat/m0-foundation`。

## 5. 批次状态与下一步

- **M0 地基**：已合并（PR #1）。**实际设计以 [`docs/plans/m0-foundation.md`](docs/plans/m0-foundation.md) 为准**，其第 6 节记录了相对最终方案的 7 处偏离：体积门禁用自写脚本而非 size-limit；token 只用一个纯 CSS 文件；schema 按批次追加字段；客户端不用 zod；消息返回 `Result`；happy-dom 和 idb 推迟引入；Port 只做传输层。
- **M0 留给后续批次的约定**：
  - 新增配置字段时，在 `schema.ts` 和 `defaults.ts` 中追加并给出默认值，不需要提升版本号。只有破坏性变更才提升 `schemaVersion` 并编写迁移。
  - Port 的调用方在切换会话前必须先 `cancelAll()`。
  - popup 的 gzip 体积已用到 74/80KB，往 popup 新增依赖之前要先评估。
  - **M1 开工前必须决定（来自 M0 深度审查）**：
    - 配置路径对数组和 Record 只支持整体替换。如果 provider 设置按 id 存成 Record，两个页面同时修改不同的 provider 时，后写入的会覆盖先写入的。二选一：改成固定键的对象（每个 provider 一个分支），或者给 `ConfigChange` 增加按记录合并或删除的操作。
    - Port 客户端本身没有超时，请求超时和中止由 M1 的调度器负责。否则 handler 不返回时，请求会一直挂起，ping 也会让 SW 一直保活。
    - `call()` 把所有发送失败都归为「后台不可达」。M1 新增的写操作应当保持幂等，因为可能出现「实际已写入、但回包丢失」的情况。
    - 以上 3 项已在 [`docs/plans/m1-translation-core.md`](docs/plans/m1-translation-core.md) 中定案：provider 用固定键对象；超时由调度器分三层负责；写操作保持幂等。
- **M1 翻译核心**：方案见 [`docs/plans/m1-translation-core.md`](docs/plans/m1-translation-core.md)，状态以该文件头部为准。
  - **已完成**（分支 `feat/m1-translation-core`，未推送，HEAD `47f7b09`）：
    - 配置字段；
    - provider 适配器：google 用 POST，LLM 一律流式；
    - 编解码、提示词、IndexedDB 缓存、密钥、权限；
    - 调度器：三层超时、公平轮转、按 endpoint 冷却、每个 Port 最多 8 个在途请求；
    - 翻译服务；
    - 后台接线，包括 Port 注册、`secrets.*`、`provider.test`、`cache.*`；
    - 配置写入只接受扩展页面发起的请求。
    - 已通过 check Deep 审查，24 项问题全部修复，`npm run check` 通过，356 个测试。
  - **剩余 3b**：
    - 先按「隐中生岛 + 琥珀」重做设置页（翻译服务）和工具栏小面板的原型，用户确认后再实现；
    - tokens.css 从墨青换成琥珀，并加对比度校验；
    - 3b 完成后再做一轮 check（只审新增的 diff），然后更新 README 和 CHANGELOG，推送、开 PR；
    - 手工验收按方案第 10 节执行，第 2–5 项需要用户自备密钥。
- **界面方向已确认**：「隐中生岛」加琥珀主题色，完整规范见 [`docs/plans/ui-isle-direction.md`](docs/plans/ui-isle-direction.md)。原型在 https://claude.ai/artifact/GJTgsP7SFHmhP6M2SczwTp 。最高原则：人的感受第一、少打扰、近乎原生的沉浸阅读。
  - 默认在所有页面上都不留痕迹，由用户主动唤起。
  - 不常驻悬浮球。
  - 支持左、右、底部三种停靠位置。
  - 动效用单一形状加弹簧驱动。
  - 旧 UI 规范 `docs/reviews/2026-11-13-ui-ux-design.md` 中被取代的章节已在其文件头标注。
- **竞品痛点即我们的差异化**（2026-11-13 调研沉浸式翻译等）：
  - 免费额度不透明、订阅弹窗打扰；
  - 大页面卡顿；
  - 排版错乱、悬停结果消失；
  - 429 只能手动换引擎；
  - 每个页面默认显示浮球，需要逐站关闭。
  - 从 M2 起，每个批次的方案都要有一节「差异化」，说明针对上述哪一条。
  - 可参考的竞品机制：沉浸式翻译公开的站点规则 JSON（`.add` / `.remove` 增量语法与 `id` 继承）、视口预翻译、字幕遇到 429 时回退原字幕。
- **留给 M2 及以后的约定**（来自 M1 方案的审查和参考项目调研）：
  - SW 被回收后，在途请求会丢失，后台不做恢复。**由 M2 的内容脚本负责 Port 重连，并重发未完成的段**；已完成的段会命中缓存。
  - **M2 开工前先实测**：`{{n}}` 一类占位符经过 Google 翻译后的保留率，再据此确定占位符格式。占位符与原文发生冲突时，换用新的随机标记（nonce）。
  - 模型写坏占位符时，用正则容错修复后再还原。还原出的 HTML 走白名单过滤，并校验 `href` 协议，拒绝 `javascript:`。
  - 行内标签用编号标记保护，并校验出现次数、配对和嵌套。用 MutationObserver 检测框架重新挂载节点，并恢复译文。
  - 首屏按字符预算优先翻译，其余用 IntersectionObserver 懒加载，`rootMargin` 设为 1000px。
  - M3 的输入翻译要兼容 Lexical、ProseMirror、Draft.js、Slate、Quill 等富文本编辑器；M5 的字幕以当前时间 ±10 秒为滚动窗口预取。
  - **来自 M1 架构审查，留到对应批次再做（现在做属于过度设计）**：
    - M2：视口优先由内容脚本控制提交顺序，调度器不加优先级。
    - M3：给 `scheduler.submit` 增加可选参数 `onDelta`，并在 `TranslateChunk` 中增加 delta 分支，用于划词流式。新增第三个调用方时，把 `service` 和 `admin` 里重复的「解析配置 → 适配器 → 提示词」抽成 `resolveJobContext()`。
    - M4：引入 `TranslateOptions`（temperature、style、glossary），统一计算 `paramsDigest`；`buildPrompt` 和 `ProviderContext` 都要接收这些参数。
    - 下次新增 provider 时：把 `resolveProviderSettings` 移出 registry，改为表驱动，并让 `SecretProviderId` 由 `Engine` 派生。

M1 和 M2（整页翻译）完成后即构成 MVP。

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

## 8. 开发流程（每个批次或任务都按此循环执行，2026-11-13 用户约定）

1. **方案**：先用 `think` skill 制定技术方案。
2. **方案审查**：对方案做一次审查。审查没问题、且用户确认之后，才能开始实现。
3. **实现**：在新分支上开发（不直接在 main 上开发），同时编写测试用例。
4. **代码审查**：完成后用 `check` skill 审查。有问题就修，修完再 check，循环到**没有阻断性问题**为止。
5. **文档同步**：更新相关文档（`CHANGELOG.md`、本文的进度日志和状态、README、方案文档等），确保文档与代码改动一致。
6. **汇报**：向用户汇报结果。
7. **提交**：提交并推送分支，视情况开 PR。
8. **合并**：CI 通过后由**用户手动合并**。Agent 不自行合并，也不开启 auto-merge。
9. **收尾**：用户告知已合并后，切回 main 拉取最新代码，清理已合并的本地和远端分支，再视情况进入下一阶段。

> 注：CI 在 M0 中建立。M0 的 PR 开出时 CI 才首次运行，需确认它能通过。

## 9. 进度日志

| 日期 | 事项 |
| --- | --- |
| 2026-11-13 | 熟悉骨架与旧方案；Fable 5.2 完成两轮评审，产出最终方案和 UI/UX 规范；用户拍板全部决策（见第 3 节）；暂不做高保真设计稿；创建本文和 `CHANGELOG.md`，提交并推送到 main。约定开发流程（见第 8 节）。下一步：M0 |
| 2026-11-13 | M0 方案 `docs/plans/m0-foundation.md` 经审查后获批。在 `feat/m0-foundation` 上实现 M0（工具链与 CI、配置仓库、消息协议与 Port 传输层、设计 token 与主题），`npm run check` 通过。状态：**已实现，待审查和合并**；第 9 节手工验收待在真实 Chrome 中执行。下一步：审查 → 推送并开 PR → CI 通过后由用户合并 → M1 |
| 2026-11-13 | 已开 PR jiangding01/easy-translate#1。按 check skill 的 Deep 流程补做了完整审查：安全、架构 2 个专项审查，加上 4 个角度的对抗式审查。确认 13 项问题并修复，每项都先写回归测试；其中 Port 修了「无法序列化的响应会让请求永久挂起」等问题。M1 开工前必须决定的事项已记入第 5 节。状态：**等待用户合并** |
| 2026-11-13 | **M0 已合并**（PR #1，合并提交 `c5b7bb2`，main 上的 CI 通过）。用户在真实 Chrome 中完成手工验收：第 1、2、3、4、5b、6 项通过；5a（`chrome://` 页面的提示）只有单元测试覆盖。LCU 的 URL 策略只允许 http/https，不能用来测试扩展页面。下一步：M1 翻译核心（分支 `feat/m1-translation-core`） |
| 2026-11-14 | **M1 后台能力完成，暂停于 3b 之前**（应用户要求，下次继续）。<br>**实现**：分三段完成。第一段 Sonnet：配置、provider、缓存。第二段 Opus：调度器与服务。3a Sonnet：后台接线。<br>**审查**：按 check skill 的 Deep 流程，做了安全、架构 2 个专项审查，加上 4 个角度的对抗式审查，确认的问题已全部修复。主要有：OpenAI baseURL 绕过权限检查；配置写入没有校验发送方；冷却作用域与超大 Retry-After；缓存淘汰阻塞读取，TTL 删除与写入有竞态；LLM 输出被截断或被拦截时，真实原因被掩盖。每项修复都有先红后绿的回归测试，目前共 356 个测试。<br>**设计**：界面方向确认为「隐中生岛」加琥珀主题色，见 `docs/plans/ui-isle-direction.md`。<br>**下一步**：3b 原型 → 3b 实现 → check → 推送并开 PR |
