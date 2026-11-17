# Easy Translate 交接文档（HANDOFF）

> 最后更新：2026-11-17 · 阶段：**M3a 划词翻译已实现并通过 check Deep 审查**（分支 `feat/m3a-selection`，未提交）。真机反馈修复已验收通过。下一步：提交并开 PR，合入 main（含 PR #10、#11）
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

- **main**：M0 地基（PR #1 已合并）。
- **main**：M1 翻译核心已合并（PR #2，合并提交 `ea507ec`）；验收修复在 PR #3。依据 `docs/plans/m1-translation-core.md`（3b 的修订见第 4.11 节）。
  - 后台：`src/lib/translate/`（provider、调度器、缓存、密钥、权限、翻译服务、管理消息、Port `et-translate`）。
  - 配置：内置引擎字段，加最多 10 个自定义服务 `customProviders`，按条目 `add` / `update` / `remove` 写入；字段映射只在 `src/lib/config/engine-fields.ts` 一处。
  - 页面共用：`src/lib/engine-view.ts`（引擎列表与就绪判断）、`src/lib/endpoint.ts`（地址与权限判断）、`src/lib/host-permission.ts`、`src/components/Select.tsx`（自研下拉）。
  - 界面：设置页（通用 / 翻译服务）与工具栏面板，按「隐中生岛」加琥珀主题重做；token 在 `src/styles/tokens.css`，对比度由 `scripts/check-contrast.mjs` 校验。
- **可用命令**：`npm run dev | build | lint | format | typecheck | test | check | check:contrast | check:size | zip`。`npm run check` 通过（M2b PR1 分支上为 550 个测试）。
- **main**：M2a 整页翻译已合并（PR #4，合并提交 `29bc384`）；真机验收发现的分段边界问题在 PR #6 修复（`cbd7a3b`）；扩展图标「暗岛微光」在 PR #5 合并（`4b61fca`）。依据 `docs/plans/m2-page-translation.md`。
  - 内容脚本：`src/content/`（`discover` 扫描与分段、`segment` 行内标记、`session` 视口队列与会话、`render` 渲染与动效、`anchor` 阅读位置、`mutations` 动态内容、`auto-start` 站点记忆、`viewport` IntersectionObserver）；`src/entrypoints/content.ts` 只在被唤起后才建立 Port 和观察器。
  - 后台：快捷键 `translate-page`、图标状态点（`src/lib/action-icon.ts`）、`site.setAlways`（只接受扩展页面）。
  - 界面：工具栏面板接通整页翻译；设置页「通用 · 译文」。
- **分支 `feat/m2b-lazy-runtime`（M2b PR1，未提交）**：内容脚本拆成首屏引导 `src/entrypoints/content.ts` 加 `src/content/bootstrap.ts`（4.88KB），以及按需模块 `src/entrypoints/page-runtime.ts`（12.29KB，WXT unlisted script，动态 URL 的 WAR）。由 `src/content/loader.ts` 在第一次唤起时 `import()`。最低 Chrome 130；配置读取改用原生 storage。依据 [`docs/plans/m2b-lazy-runtime-and-isle.md`](docs/plans/m2b-lazy-runtime-and-isle.md)。
- **main**：M2b 已合并：PR #8 按需加载（首屏 4.96KB），PR #9 灵岛（`src/content/isle/`，配置 `page.isleDock`，后台 `engine.options`）。
- **分支 `feat/m3a-selection`（M3a，未提交）**：
  - 后台流式：`stream`/`force`、delta/reset 帧、`text` 格式提示词与清洗、调度器的插队与交互预留名额；
  - 第二个按需模块 `selection-runtime.js`（16.84KB / 18KB）；
  - 引导层的选区观察（`src/content/selection/watch.ts`，首屏 6.81KB / 7KB）；
  - 卡片（`src/content/selection/{extract,place,card,request,speech,styles}.ts`）；
  - 右键菜单（`contextMenus` 权限）与快捷键 `translate-selection`（Alt+Shift+S / ⌃⇧S）；
  - 配置 `selection.showDot`。
  - 依据 [`docs/plans/m3a-selection.md`](docs/plans/m3a-selection.md)。
- **还没有**：M3d 动态页与站点规则、M3b 段落级交互、M3c 指令台与灵岛键盘、M3e 本地引擎。

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
  - **已合并**（PR #2）：
    - 后台：provider（google 用 POST，LLM 一律流式）、编解码、提示词、IndexedDB 缓存、密钥、权限、调度器、翻译服务、后台接线；
    - 3b：多个自定义服务、琥珀 token 与对比度校验、设置页、工具栏面板、自研下拉组件；
    - 审查：后台部分做过一轮 Deep 审查；3b 做过两轮 Deep 审查（安全、架构、四个对抗角度，再加修复后复查），下拉组件做过一轮 Standard 审查；确认的问题都已修复并补了回归测试。
  - **真机验收**（2026-11-14，用户在 Chrome 中用生产构建验证）：Google 测试连接、DeepSeek 保存密钥、添加本地 Ollama（授权提示、设置 `OLLAMA_ORIGINS` 后连通）、删除默认自定义服务回退到 Google、通用页下拉（含键盘）、亮暗主题、工具栏面板的各种状态都通过。清空缓存要等 M2 有网页翻译后才能测。发现的问题在 PR #3 修复。
  - **开发版提示**：WXT 的开发构建会给 manifest 加上 `http(s)://*/*`，Chrome 会提示可选权限多余；授权流程只能用生产构建（`npm run build`）测试。
- **M2 整页翻译**：方案见 [`docs/plans/m2-page-translation.md`](docs/plans/m2-page-translation.md)。
  - **M2a（已合并，PR #4、#6）**：check Deep 审查完成（安全、架构、对抗式三路，会话与渲染加 Fable 复查）。确认并修复的问题：停止与在途渲染写入的竞争（会留下孤儿译文）、会话译文记忆用 32 位哈希作键（可被碰撞顶替译文，改用完整原文）、对话框把应用根标为 `aria-hidden` 时整页译文被清掉、长会话里已卸载 DOM 被强引用、「仅译文」自身 CSS 干扰块级判断、停止时取消整个 Port、页面可伪造 `<style data-et>`、启动失败卡在运行中、面板轮询乱序。每项都有先红后绿的回归测试。第二轮 Fable 复查确认修复有效，并抓到一个由修复引入的重复译文问题（混合父元素失去块级子元素），已修复。共 515 个测试。
  - **M2a 真机验收**：按方案第 10 节，包括 4 倍 CPU 降速下的动效检查；设置页「译文」卡片与面板的实际观感需要在真实 Chrome 里看。
  - **分段边界规则（2026-11-14 真机验收后修订）**：块级还是行内只看计算样式（`src/content/dom-rules.ts` 的 `isInlineElement`，对齐 FluentRead `isBlockBoundary`）：语义块标签总是边界，`code`/`img`/`br` 等总是行内，其余按 `display`（`inline*`、`contents` 为行内）。弹性布局和网格的子元素会被浏览器块级化，因此各自成为单元；M2a 原先「横向弹性布局合成一个单元」的做法已放弃：项之间的间距由 CSS 绘制，合并会把文字粘在一起（如「01Home PAGE」）。
    - 例外（仍留在句子里）：脱离文档流的元素（`sr-only`、浮动徽章）按标签判断；`inline-flex`/`inline-grid` 小块内部的项算行内；`display: ruby*` 算行内，注音 `rt`/`rp` 不翻译。
    - 已知取舍（与 FluentRead 相同）：弹性容器里「直接写的文字 + 链接」会被分成两段翻译，行内片段的译文还会成为容器的一个新项，在 `justify-content: space-between` 的容器里可能被推到中间。FluentRead 靠把原文包进一个合成 span 来避免，我们不移动网页节点，暂不做；真机验收时留意。
  - **M2b**：方案见 [`docs/plans/m2b-lazy-runtime-and-isle.md`](docs/plans/m2b-lazy-runtime-and-isle.md)，拆成两个 PR。
    - **加载方式已定（2026-11-16，用户拍板）**：内容脚本 `import()` 声明了 `use_dynamic_url` 的单文件 WAR。后台注入被否决：`executeScript` 只认 `host_permissions`，内容脚本的 `matches` 不算，必须申请全部网站权限。调研和实测见方案附录 A。
      - 硬约束：按触发时机分包；按需文件是单文件、零 import；跨包只共享类型和无副作用的常量；灵岛等 UI 里**禁止出现任何扩展地址**（图片、CSS `url()`、字体），否则网页能截获动态地址；自定义品牌字体基本不可用。
    - **PR1 按需加载与首屏瘦身**：已实现，check Deep 审查完成（方案附录 C）。自动验收 8 条通过，第 6 条和版面观感由用户手动确认通过（方案附录 D），待提交并开 PR。
    - **PR2 灵岛**：原型已确认（Design artifact 的 `IsleM2` 页），方案见第 9 节；已实现，check Deep 审查完成（附录 F）；自动验收和用户真机验收通过（附录 G）；真机验收后，按新原型把底部停靠改为右下角，并补上横幅抬升、避让对齐、提示框淡出和小点暗边的修复，已经过增量审查（附录 H），用户复验通过，已提交并开 PR。分支 `feat/m2b-isle`。新增配置 `page.isleDock`、后台只读消息 `engine.options`、会话的 `subscribe`，以及 `src/content/isle/`、`src/styles/tokens-isle.css`。
    - **已知限制**：WXT 内容脚本包装层仍会在 `document` 上派发带扩展 ID 的 CustomEvent，已知 ID 的网页可以借它确认扩展存在；`postMessage` 广播已关闭。带 `CSP: sandbox` 头的本地页面实测能正常加载按需模块并翻译，没有回归。
    - **另开事项**：`src/lib/translate/cache.test.ts` 的「keeps serving reads while a large eviction runs in batches」是时序敏感用例，全量跑时偶发失败。
  - **审查留下的结构建议（不阻塞）**：内容脚本的装配可抽成 `src/content/runtime.ts`，供 M3 划词共用 Port 与配置；`PageState` 与 `PageStatus` 可合并成一份；设置页预览引用了 `src/content/styles.ts`，样式常量可移到 `src/lib`；`site-memory.ts` 可拆读写两侧，给内容脚本减重。
  - **图标**：已完成「暗岛微光」（PR #5）：暖黑超椭圆底板，一条暖白长线（原文）加一条琥珀短药丸（译文），右下角给状态点留位置；16/32/48 各自按像素网格绘制，128 四周留 16px。PNG 与 `docs/assets/icon/` 的 SVG 都由 `scripts/build-icons.mjs` 生成（`npm run build:icons`）；状态点的底图读 `icon/16.png` 和 `icon/32.png`。
- **M3**（2026-11-16 用户拍板）：拆成 M3a 划词 → M3d 动态页与站点规则 → M3b 段落级交互 → M3c 指令台与灵岛键盘 → M3e Chrome 内置本地引擎。词典态推迟到 M5，与生词本一起做；朗读用 `speechSynthesis`。竞品机制参考 [`docs/reviews/2026-11-16-fluentread-m3-research.md`](docs/reviews/2026-11-16-fluentread-m3-research.md)（本地 FluentRead 调研，只借鉴思路）。
  - **M3a 划词**：原型是 Design artifact「M3 划词翻译」页的 `SelectionM3a`（已确认）；方案经 Opus 对抗式审查修订后获批；分三段实现（A 后台流式、B 接线与配置、C 卡片），`npm run check` 全绿（887 个测试）。
    - Chrome for Testing 自查 8 项通过：用真实 Google 引擎实测，单词、半句、整句三种选区的原文行和译文都一一对应；自查中修了「小点自己展开」的 bug。
    - 用户已同意：方案 1.4 节的全部文案；首屏预算 7KB；`selection-runtime` 预算 18KB；卡片语言名与面板统一（English → 简体中文）。
    - **2026-11-17 已完成 check Deep 审查**：两位 Opus 审查者按领域分工，发现中等问题 4 项、低等若干项，全部修复并补了回归测试，共 924 个测试（方案附录 B）。首屏体积 6.96KB / 7KB，余量很小，以后往引导层加东西前要先评估。
    - **2026-11-17 真机反馈调整与增量审查已完成**（方案附录 D、E）：卡片以小点为锚、滚出视口后停放、避开灵岛、朗读选声、小点避开指针；体积方案选择错误文案改由后台提供（Fable 裁决），共 993 个测试。**首屏 content 只剩约 10 字节余量，下次改引导层前要先处理**（瘦身，或经用户同意调预算）。
    - **原暂停点（已推进到用户复验）**：
      1. 用 check skill 对 M3a 做 Deep 审查（安全与架构、对抗式），修复，必要时做增量审查；
      2. 在 Chrome for Testing 上跑方案 6.2 节的自动验收（产物复制到临时目录，不碰 `.output`）；
      3. 用户真机验收，包括快捷键冲突核对：GitHub、Google Docs、Notion、Outlook、维基百科；
      4. 同步 CHANGELOG、README，以及方案的状态和审查附录；
      5. 提交并开 PR。
    - **M3a 之后的小 PR：英语单词音标**（2026-11-17 用户拍板）：
      - 显示规则：只在选中单个英文单词时显示（允许连字符、撇号），在原文行单词后面显示 `/IPA/`；查不到就不显示。
      - 数据源：ECDICT（MIT 许可，与 M5 词典共用同一份数据）按词频取约 3 万个常用词，只取音标字段，随扩展打包，由后台按需读取；离线、不新增权限。音标偏英式，每个词只有一种读音。
      - 流程：M3a 合并后另开分支，先出方案。
    - **整页翻译待处理（2026-11-17 用户真机发现，留到 M3d 专门处理）**：
      - **现象**：claude.dev 博客 `spending-your-effort` 页「Lightly specified design task」小节的示意图（`figure.efx-fig` 里用 DOM 画的终端设置界面：等宽字体、flex 行、短标签，并且由 `efx-slot` 懒加载）被翻译后排版拥挤。标题变成「Settings设置」；标签页一行在原有标签后面追加了「常规 显示 输…」，挤出容器被裁掉；每行在标签后面追加译文，比如「Model› 模型」「Default (recommended)默认（推荐）」。
      - **DOM 已确认**（用户在 DevTools 里截图）：`figure.art-fig.viz.efx-fig[aria-label="The Claude Code /config redesign at each effort level"] > .efx-view > .efx-rail > .efx-slot[role=group][aria-label="Low effort config screen"] > .efc-low > .stage(grid) > .term[tabindex=0][aria-label="Interactive config mock"](可滚动)`。标签页那一行是 `div.efc-low-row.tabs`，里面是一串行内 `span`，整行被当成一个单元，`<et-tr>` 以行内方式追加在这一行的末尾，被挤出容器后裁掉。
      - **顺带发现两处**：
        1. 产品名被直译：「Sonnet」被译成「十四行诗」。这属于专有名词保护，留给 M4 术语库；
        2. 行首的装饰符号「•›」被带进了译文，变成「Model •› 模型 •」。
      - **初步判断**：
        1. 页面特殊：这是用 HTML 画的「界面截图」，读者通常不需要翻译里面的界面文字；
        2. 我们的算法也有不足：flex 行里的短标签各自成为一个单元，译文以行内方式追加在原文后面。遇到定宽、`overflow:hidden`、不换行的容器，就会挤乱或被裁掉。
      - **候选改法**（待 M3d 出方案时定）：
        1. 识别「界面示意」区域：以等宽字体为主、由大量短文本组成的容器，或 `role=img`、`aria-hidden` 的 figure，默认不翻译。也可以考虑：在 `<figure>` 内部只翻译 `figcaption` 和普通段落；
        1b. 单元里的装饰符号（•、›、▸ 等）不要进入要翻译的文本；
        2. 版面安全：单元所在的容器定宽、隐藏溢出或不换行时，不做行内追加，改为放到下方，或者跳过；
        3. 站点规则（M3d 本来就要做）：允许按站点排除选择器，例如 `.efx-fig`；
        4. 以后可以加「不翻译此区域」的手动入口。
      - **另一项 M3 后的改进**：AI 引擎的整页翻译改为逐段出现。模型还在生成一批时，后台边收边解析，某一段完整了就立即渲染；首屏第一批切小。用户已同意排在 M3a、音标之后。
    - **2026-11-17 真机反馈修复已验收通过**（方案附录 F）：
      - Google 偶发「部分句子原样回显」被写进 7 天缓存，每次复现。新增 `src/lib/translate/echo.ts` 的 `isEchoedTranslation`；`scheduler.ts` 的 `complete()` 对回显条目不写缓存；`providers/google.ts` 的 `retryEchoed` 用 `/translate_a/single` 重试一次，失败则保留原结果并停止重试。已补回归测试。
      - 卡片水平定位改为优先向右展开（`src/content/selection/place.ts`）；卡片滚动条改为透明轨道加细滑块。
      - 验收第 3 项（错误文案）、第 8 项（DeepSeek 流式）通过。
      - 体积（gzip）：content 6.99/7KB、page-runtime 21.86/24KB、selection-runtime 17.06/18KB、background 49.08/60KB、popup 79.59/90KB、options 86.21/150KB。
    - **M3a 之后的待办**：
      - **面板设置入口不易发现**：面板右下角设置按钮的图标是「圆加八条短线」，像太阳或亮度，用户没认出来。计划 M3a 合并后单独开小 PR，改为齿轮并加「设置」文字，先出效果给用户定。
      - **卡片「重试」不绕过缓存**：只在出错时出现，成功但内容坏的卡片没有入口，暂不做。
      - **「翻译服务返回了空结果」未能复现**（claude.dev，Google）：根因未知，推测与当时出口 IP 被 Google 限流降级有关；再遇到需要抓现场。
      - **PR #10、#11 已合并到 main**（`cache.test.ts`、`service.test.ts` 偶发失败修复）：M3a 提交后需要合入 main。
    - **已知待观察**：40 字以内的英文句子，Chrome 语言检测常报不可靠，卡片顶部显示「自动检测」，这是检测本身的限制。
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
  - **来自 M1 第 3b 步，留给 M2 的事项**：
  - 工具栏面板体积预算已从 80KB 调到 90KB（React 运行时是固定开销）。M2 往面板加功能时，如果超过 90KB，先评估更轻的运行时，不再直接调预算。
  - 工具栏图标改成单色字形加状态小点（已翻译用琥珀色，有失败用珊瑚色），和 `action.setIcon` 一起做；面板上「翻译此页」「这次先用 Google 翻译」「总是翻译此站」随 M2 接入。**M2a 已接入状态点和面板；图标已按「暗岛微光」重新设计（PR #5）。**
  - ~~manifest 没有设置 `minimum_chrome_version`~~：M2a 定为 117。
  - ~~兼容 OpenAI 接口的流式响应在后台累积时没有长度上限~~：M2a 加了 64000 字上限（OpenAI 兼容与 Gemini），超过按截断处理。
  - 同一地址上的多个自定义服务共享限流冷却（有意为之）；如果用户反馈同一聚合平台上多个账号互相拖累，再改成按地址加密钥区分。
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
| 本地 Ollama 接受扩展后台发出的请求（来源为 `chrome-extension://`） | **已实测（2026-11-14）：默认拒绝，返回 403** | 已处理：本地 403 单独提示设置 `OLLAMA_ORIGINS`，README 有接入说明；设置后必须从菜单栏彻底退出 Ollama 再打开 |
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
| 2026-11-16 | **M2b PR2 灵岛已合并**（PR #9）。**M3 规划**：拆成 5 个小批次；调研 FluentRead。**M3a 划词翻译完成实现与自查**（分支 `feat/m3a-selection`，未提交）：原型确认 → 方案（Opus 审查查出 3 项阻断、12 项应修，已修订）→ 三段实现，887 个测试 → Chrome for Testing 自查 8 项通过。按用户要求，**暂停于 check Deep 审查之前**。<br>**另开事项**：`cache.test.ts` 的时序用例已在单独的会话中修稳（PR #10，只改了测试文件，待合并）；该会话又发现 `service.test.ts` 有一条偶发失败的用例，原因是 `waitFor` 只等到 8 个挂起请求中的 6 个已派发，`hanging[0]` 可能还没派发就被取消，导致 aborts 计数为 0。这条还没修，需要另行处理 |
| 2026-11-16 | **M2b PR1 已合并**（PR #8）。**M2b PR2 灵岛完成实现与审查**（分支 `feat/m2b-isle`）。<br>**原型**：在 Design artifact 新增 `IsleM2` 页，用户确认；规范第 2 节第 7 条改为「暗色网页上也用深岛加描边」。<br>**方案**：m2b 方案第 9 节，经 Opus 对抗式审查（3 项阻断、14 项应修）修订，再由主会话对照代码复核。<br>**实现**：分两段（Sonnet 做接口和配置，Opus 做灵岛），page-runtime 21.34KB。<br>**审查**：check Deep，修了停靠来回切换后隐身、换引擎后错误算错引擎等，633 个测试。<br>**验收**：自动 10 条通过；用户真机 4 倍降速下 INP 40ms。<br>**真机后调整**：底部停靠改右下角、横幅抬升、避让对齐、提示框淡出、小点暗边（附录 H），增量审查修 5 项，682 个测试，用户复验通过。<br>**下一步**：PR 合并 → M3 |
| 2026-11-16 | **M2b PR1 按需加载完成实现与审查**（分支 `feat/m2b-lazy-runtime`）。<br>**调研**：灵岛加载方式由 Fable 5.2 裁决，选动态 URL + 单文件按需模块；实测否决后台注入（需全站权限）。<br>**方案**：`docs/plans/m2b-lazy-runtime-and-isle.md`，经 Opus 对抗式审查修订。<br>**实现**：内容脚本 19.43KB → 4.88KB，会话代码拆进按需模块 `page-runtime.js`（12.29KB）；配置读取改原生 storage；最低 Chrome 130；构建检查用 `node:vm` 验证单文件、严格模式下可执行和注册生效。<br>**审查**：check Deep（安全与架构、对抗式各一位 Opus），修了 WXT 默认向网页广播扩展 ID 等 5 项，550 个测试。<br>**下一步**：真机验收 → 提交并开 PR → PR2 灵岛原型 |
| 2026-11-13 | 熟悉骨架与旧方案；Fable 5.2 完成两轮评审，产出最终方案和 UI/UX 规范；用户拍板全部决策（见第 3 节）；暂不做高保真设计稿；创建本文和 `CHANGELOG.md`，提交并推送到 main。约定开发流程（见第 8 节）。下一步：M0 |
| 2026-11-13 | M0 方案 `docs/plans/m0-foundation.md` 经审查后获批。在 `feat/m0-foundation` 上实现 M0（工具链与 CI、配置仓库、消息协议与 Port 传输层、设计 token 与主题），`npm run check` 通过。状态：**已实现，待审查和合并**；第 9 节手工验收待在真实 Chrome 中执行。下一步：审查 → 推送并开 PR → CI 通过后由用户合并 → M1 |
| 2026-11-13 | 已开 PR jiangding01/easy-translate#1。按 check skill 的 Deep 流程补做了完整审查：安全、架构 2 个专项审查，加上 4 个角度的对抗式审查。确认 13 项问题并修复，每项都先写回归测试；其中 Port 修了「无法序列化的响应会让请求永久挂起」等问题。M1 开工前必须决定的事项已记入第 5 节。状态：**等待用户合并** |
| 2026-11-13 | **M0 已合并**（PR #1，合并提交 `c5b7bb2`，main 上的 CI 通过）。用户在真实 Chrome 中完成手工验收：第 1、2、3、4、5b、6 项通过；5a（`chrome://` 页面的提示）只有单元测试覆盖。LCU 的 URL 策略只允许 http/https，不能用来测试扩展页面。下一步：M1 翻译核心（分支 `feat/m1-translation-core`） |
| 2026-11-14 | **M2a 已合并，真机验收通过**。<br>**合并**：M2a（PR #4，`29bc384`）、扩展图标「暗岛微光」（PR #5，`4b61fca`，另开会话完成；状态点改为直接读 16、32 号图标）、分段边界修复（PR #6，`cbd7a3b`）。<br>**真机验收**：用户在 claude.dev 博客页验证：正文按模块随懒加载翻译，刷新后命中缓存直接显示；发现列表、页脚、目录的译文错位，根因是先看标签把排成块的 `<a>`、`<span>` 当行内，PR #6 改为按计算样式判断（对齐 FluentRead），Fable 审查补了脱离文档流元素、行内弹性小块和 ruby 三个例外，523 个测试。导航、按钮、标签页、输入框按规则跳过；界面小标签（如「TREE」）的排除和专有名词保护分别留给 M3 站点规则和 M4 术语库。<br>**下一步**：新会话开始 M2b（先定按需加载方式与订阅接口，再补原型） |
| 2026-11-14 | **M2a 整页翻译完成实现与审查**（分支 `feat/m2-page-translation`）。<br>**实现**：扫描与分段、视口队列与 Port 会话、渲染与动效（WAAPI，只动 opacity 和 filter）、双语与仅译文、动态内容、快捷键、图标状态点、站点记忆、面板与设置页「译文」。顺带完成 M1 留下的两项：大模型流式输出 64000 字上限、最低 Chrome 117。<br>**审查**：check Deep，三路专项（安全 Fable、架构 Sonnet、对抗式 Fable），修复后 Fable 复查；确认问题见第 5 节，全部修复并有回归测试；第二轮复查发现的新问题也已修复，515 个测试。<br>**下一步**：推送并开 PR → CI → 用户真机验收并合并 → 新会话开始 M2b（先定按需加载方式与原型） |
| 2026-11-14 | **M1 已合并**（PR #2，CI 全绿，用户手动合并）。用户用生产构建做了真机验收，主要流程都通过。发现 7 个问题：展开行背景偏粉（白色 token 色相为 0，OKLCH 混合时被拉向粉色）、本地 Ollama 返回 403 被误报为密钥无效、对话框初始焦点、文字按钮焦点框、详情区首行焦点框被裁、下拉宽度、README 缺 Ollama 说明，都在 PR #3 修复。<br>**下一步**：PR #3 合并 → M2 整页翻译方案（先出原型） |
| 2026-11-14 | **M1 第 3b 步完成**。<br>**原型**：设置页、工具栏面板，以及加宽的「添加服务」对话框和自研下拉，用户确认后实现。<br>**变更**：自定义服务从 1 个改成最多 10 个，按条目写入；主题换成琥珀，组件只引用 token；自研下拉取代原生下拉；工具栏面板体积预算调到 90KB。<br>**审查**：3b 做了两轮 Deep 审查（安全、架构、四个对抗角度，加修复后复查），下拉组件做了一轮 Standard 审查。修掉的主要问题：同一服务快速连改两处会互相覆盖；删除后的迟到修改会让服务复活；记录键名含「.」或叫 `constructor` 时会清空全部设置；孤儿密钥（改为后台负责清理，只读配置下不清理）；测试连接可能占住调度槽 180 秒。下拉组件的审查修了读屏读不出当前值、面板误把未授权服务标为可用等 8 项。共 416 个测试。<br>**下一步**：推送并开 PR → CI → 用户手工验收并合并 → M2 |
| 2026-11-14 | **M1 后台能力完成，暂停于 3b 之前**（应用户要求，下次继续）。<br>**实现**：分三段完成。第一段 Sonnet：配置、provider、缓存。第二段 Opus：调度器与服务。3a Sonnet：后台接线。<br>**审查**：按 check skill 的 Deep 流程，做了安全、架构 2 个专项审查，加上 4 个角度的对抗式审查，确认的问题已全部修复。主要有：OpenAI baseURL 绕过权限检查；配置写入没有校验发送方；冷却作用域与超大 Retry-After；缓存淘汰阻塞读取，TTL 删除与写入有竞态；LLM 输出被截断或被拦截时，真实原因被掩盖。每项修复都有先红后绿的回归测试，目前共 356 个测试。<br>**设计**：界面方向确认为「隐中生岛」加琥珀主题色，见 `docs/plans/ui-isle-direction.md`。<br>**下一步**：3b 原型 → 3b 实现 → check → 推送并开 PR |
