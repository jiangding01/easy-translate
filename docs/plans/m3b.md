# M3b 段落级交互：范围与拆分

> 状态：**2026-11-20 用户批准第 3 稿**，含体积预算（content 7.5 KB 于 PR4 生效，page-runtime 27 KB）。进度：PR1 已完成（`#61`）。第 1 稿经 Opus 对抗式审查（阻断 2 项、重要 7 项），第 2 稿经增量审查（阻断 0 项、重要 6 项），两轮结论都是「改后可批准」，均已逐条处理，处理记录见文末附录 A、B。各 PR 的方案与实施记录各自成文，本文只记范围、拆分与决定。

## 结论
M3b 收敛为 6 个独立可合并的小 PR：先修两类版面问题，再给常驻层瘦身，然后分两步做「按住修饰键切换段落」（先只在整页会话内生效，再支持不开整页的局部翻译），最后接设置项。**仅译选区不做**，**区域选择器（翻译 / 不翻译此区域）移到 M3c**，右键菜单不加项。

## 范围来源与核对
- `docs/reviews/2026-11-13-final-plan.md` M3 行：Alt+悬停译段、仅译选区、右键菜单。
- `HANDOFF.md` 第 5 节「整页翻译待处理」候选改法 1b、2、4，以及 `docs/plans/m3d.md` 决定 8：装饰符号剥离、版面安全、手动「不翻译此区域」后移 M3b。
- HANDOFF 第 5 节「既有问题（#56 核对时发现）」：只含行内 `code` 或 `role=img` 的块发出只有占位符的请求。
- 已核对的既有约定：
  - `m3d.md` 决定 5「站点排除规则只内置、不开放编辑」：本批的「不翻译此段」只在页面生命周期内有效，不持久化，不冲突。
  - HANDOFF 第 3 节「默认快捷键不用 Option 组合」：针对会输出字符的组合键；按住单个修饰键不输出字符，不冲突。
  - `ui-isle-direction.md`「所有操作都是指令」：指令注册表在 M3c 建立；本批手势直接调用会话接口，M3c 再登记为 `paragraph.toggle`。
  - `m3d.md`「以后若必须在常驻层加逻辑，先瘦身再谈预算」：PR3 先瘦身，PR4 再申请预算。
  - `docs/dom-contract.md`：本批不新增 `data-et-state` 取值，不改 DOM 约定。

## 借鉴 FluentRead（本地 `/Users/jiangding/FluentRead`，只借思路）
| 机制 | FluentRead 做法 | 本批取舍 |
|---|---|---|
| 修饰键状态 | 自维护按下集合，要求与配置键完全相等；夹带其他键即作废；`blur` / `pagehide` / `visibilitychange` / `mouseleave` 重置（`src/features/hover-translation/content/index.ts:85-107,267-343`） | 照搬，另加 `wheel`、`pointerdown`、`buttons ≠ 0` 作废，并在指针移动时用 `event.ctrlKey` 等校验，防 keyup 丢失 |
| 防输入误触 | `isComposing`、keyCode 229、正在编辑时丢弃（同文件 `:232,264`） | 照搬 |
| 命中段落 | `elementsFromPoint` 先排除可编辑；`caretPositionFromPoint` / `caretRangeFromPoint` 取文本节点再找段落（`src/features/hover-translation/content/engine.ts:1134-1188`） | 照搬，段落归属复用 `discoverUnits`，并先过 `protectedAncestor` |
| 到期再确认 | 同一候选移动只更新坐标，到期再解析一次，变了就丢弃（`src/features/full-page-translation/…/hoverScheduler.ts:83-115`） | 照搬 |
| 单按切换、按住扫过 | 松开修饰键的单次触发是切换；按住滑动只译不还原 | **不照搬**：单按会被 ⌃Space（macOS 切换输入法）、Ctrl+Space（Linux ibus/fcitx）误触；改为「按住 400 ms 切换」，本批不做扫过 |
| 整页开着时还原 | 记为用户取消，之后不再重译 | 照搬，即本批的「不翻译此段」 |
| 区域选择 | 封闭 Shadow 里画框，↑ 扩大 ↓ 缩小，Enter 确认，可记住为 CSS 路径 | 移到 M3c；不做 CSS 路径记忆（改版即失效） |
| 版面 | 照常插入，再用 `!important` 租约解除裁剪；不检测 `nowrap` | 不学：插入前按 `nowrap` / `ellipsis` 判断，请求发出前就跳过 |
| 装饰符号 | 未剥离；要求至少两个 `\p{L}` | 只剥纯分隔符；我们 `classifyText` 已有「至少 2 个字母」 |

## 拆分（按顺序）
| 顺序 | PR | 范围 | 新文案 / 配置 |
|---|---|---|---|
| 1 | `fix/letterless-and-separators` | 见第 1 节 | 无 |
| 2 | `fix/layout-safe-inline` | 见第 2 节 | 无 |
| 3 | `refactor/content-slim` | 见第 3 节 | 无 |
| 4 | `feat/hold-toggle` | 见第 4 节：整页会话内按住 Ctrl 切换段落 | 无 |
| 5 | `feat/hold-toggle-scoped` | 见第 5 节：不开整页也能按住 Ctrl 译段 | 无 |
| 6 | `feat/hold-toggle-setting` | 见第 6 节：设置项 | 新配置 `page.holdKey`，设置页文案（三语） |

每个 PR 都能单独合并、合并后可用：PR1、PR2 是独立修复；PR3 只换判断位置；PR4 合并后整页会话里就能逐段还原、重试；PR5 合并后不开整页也能译段；PR6 只加开关。PR4 至 PR6 之间不发版。

### 1. 无字母单元与分隔符（`fix/letterless-and-separators`，只改 page-runtime）
1. **无字母单元**：现状 `classifyText` 已要求至少 2 个字母（`src/content/text.ts:22,30`），漏网原因是 `segment` 把 verbatim 元素与 `role=img` 的文字计入了 `plain`（`segment.ts:61`）。改为：计算 `plain` 以外，另算「去掉 verbatim 与 `role=img` 内容后的文字」，它过不了 `classifyText` 的单元不发请求。原有的 2 字母规则保留，不替换。
2. **纯分隔符剥离**：只剥单元开头或结尾、与正文之间隔着空白或元素边界的纯分隔符：`• · ‧ ∙ ◦ ‣ › » ▸ ▹ |`，以及整段只由它们构成的首尾行内元素。`✓ ✗ ★ * ⚠ → -` 等可能带语义的符号一律不动；`a›b` 这类紧贴正文的不剥。剥离只影响发送的文本与渲染出的译文，原文节点不动。在「仅译文」模式下，被剥掉的分隔符会随原文一起隐藏，这是接受的取舍：分隔符不带语义。
3. **缓存**：剥离后发送的文本变了，`digest` 随之改变，旧缓存自然失效，不需要迁移。
4. **测试**：segment 单测先红后绿（只含 `code` 的块、`role=img` + 1 个词、`•› Model`、`✓ Free shipping` 保留 ✓、`a›b` 不剥、emoji 加变体选择符不被误剥）；e2e 断言只含 `code` 的块不发请求。

**实施记录（PR1）**：
- `segment` 新增 `prose` 字段：去掉 verbatim 元素与 `role=img` 内容后的文字；`discover` 改用 `classifyText(seg.prose)` 判断，不足 2 个字母不发请求。`12 <code>x</code>` 这类只剩数字的也判为噪音。
- 分隔符由 `separatorTrims` 处理，只在文本叶子上剥；被剥空的首尾行内元素不留占位符；与开头 `«` `‹` 配对的结尾 `»` `›` 保留（法语书名号）。原文节点不动。
- check 审查 2 轮：第 1 轮发现 `« Bonjour »` 结尾被误剥，先红后绿修复；第 2 轮无新问题。单测 1659 个（77 个文件），e2e 新增 1 条（只含 `code` 的块不发请求），page-runtime 24.46 / 25 KB，预算未调。

### 2. 行内追加的版面安全（`fix/layout-safe-inline`，只改 page-runtime）
1. **判定条件**（只看单元根自身的计算样式；`white-space` 会继承，不必再往上查）：
   - 行内追加的单元（行内 run，或弹性 / 网格根）：`white-space` 为 `nowrap` 或 `pre` → 不翻译；
   - 任何单元（含块级）：`text-overflow: ellipsis`，且同时 `white-space` 为 `nowrap` 或设了 line-clamp → 不翻译。这覆盖 Tailwind `truncate` 用在弹性行内 `<span>` 上的常见情况：这个 span 是弹性项，会被块化成块级单元，译文会被追加进截断的盒子里。`ellipsis` 单独出现不生效，不算。
   这两条都是作者明确要求「单行显示」。第 1 稿里「弹性行 + `overflow:hidden`」一条删除：`row`、`nowrap` 是弹性布局默认值，圆角卡片又常带 `overflow:hidden`，会把 Tailwind 定价卡这类正常列表整列误杀。
2. **判定位置**：在会话把单元排进请求队列（`want`）之前判断，**请求不发出、不计费**。样式读取器（`dom-rules.ts:227-290`，现只读 `display` / `position` / `float`）补读 `whiteSpace`、`textOverflow`，测试用的假读取器同步扩充。不需要额外集合：每次 want 都重新判断，样式读取有缓存。
3. 其余块级单元不受影响（原有的 line-clamp 解除照旧）。用户按住修饰键切换（PR4）时，被版面安全跳过的段照常翻译：这是用户明确要求，再按住一次即可还原。
4. **测试**：新增 fixture `tests/fixtures/layout-safety.html`，含 `nowrap` 导航、`truncate` 标题（弹性行内的 span），以及两个反例：Tailwind 风格的 `.rounded-xl.overflow-hidden` 卡片内 `<li class="flex gap-2"><svg/>Unlimited projects</li>`，和只有 `text-overflow: ellipsis`、没有 `nowrap` 的段落，两者都必须照常翻译。render 与 session 单测各补先红后绿用例；e2e 加 1 条。

### 3. 常驻层瘦身（`refactor/content-slim`）
- **实测**（审查者在临时副本上测得）：去掉 `sampleText` 与 `pageIsInLanguage`，content 从 6.99 KB 降到 6.58 KB，省 0.41 KB。
- **做法**：把这两个函数从 `auto-start.ts` 移进 page-runtime。常驻层只判断「此站在『总是翻译此站』名单里」，然后加载 page-runtime，由它抽样判断语言。
- **行为变化**（不是「无变化」）：名单内的站点即使页面已是目标语言，也会加载 page-runtime。名单外的站点不受影响。
- **判断时机**：`begin` 会同步把 `phase` 设为 `running`（`session.ts:783`），所以语言判断必须在调用 `start` 之前。运行时接口（`runtime-contract.ts`）新增自动开始入口 `autoStart()`：先抽样判断，页面已是目标语言就直接返回，不调用 `start`、不上报状态；否则调用 `start`。`bootstrap.startIfIdle` 改为调用它。
- **测试**：auto-start 的单测随函数搬到 page-runtime 一侧；补 1 条「名单内、页面已是目标语言：加载但不开始、不上报状态」；e2e 不变。

### 4. 整页会话内按住 Ctrl 切换段落（`feat/hold-toggle`）
**手势**（默认键 Ctrl，macOS 为 ⌃）：
- 指针静止时**按住 Ctrl ≥ 400 ms**，期间没有按其他键、没有滚轮、没有按下鼠标键，就切换指针下的段落。**每次按住只触发一次**，松开前不再触发。
- 「静止」由常驻层判定：按住期间指针累计移动超过 6 px 就重新计时（常驻层不读 DOM，无法判断是否「同一段」）。到期后 page-runtime 再按到期坐标解析命中。
- 作废：夹带其他键；`wheel`；`pointerdown`；按下 Ctrl 时上一次指针事件的 `buttons ≠ 0`（拖拽中；键盘事件本身没有 `buttons`）；指针移动时 `event.ctrlKey` 为假（keyup 丢失）；窗口失焦、`visibilitychange`、指针离开文档。
- `event.repeat` 的 keydown 不开始计时：Windows 上按住 Ctrl 用 Ctrl+Tab 切回本页时，会收到连发的 keydown。失焦或切标签之后，必须等到新的指针移动才重新开始判定。
- 不触发：焦点在输入框、文本域或可编辑区；输入法组合中（`isComposing` 或 keyCode 229）；指针在灵岛、划词卡片上；自页面加载以来没有指针移动（不知道指针位置）。
- 为什么是按住而不是单按：⌃Space、Ctrl+Space 切换输入法时，系统吞掉 Space，页面只看到 Ctrl 按下又松开，单按会误触。按住 400 ms 时，快捷键早已结束。

**常驻层**（`src/content/hold/watch.ts`，计入 content 预算）：只记录指针坐标和修饰键状态，判定成立时调用 `bootstrap.holdToggle({ x, y })`；不读样式、不建 Port。扩展失联时与划词监听一起停止（`content.ts:81` 的 `onContextLost` 一并处理）。**本 PR 只在已有整页会话时生效**：bootstrap 看 `sessionPromise`（`bootstrap.ts:61`）是否存在，存在时再看 `state().phase !== 'idle'` 且没有 `halted`；不满足就直接返回，不加载 page-runtime。

**page-runtime**：
- 命中解析：`caretRangeFromPoint` 取文本节点；落在 `<et-tr>` 上就映射回它的原文单元。从命中元素到 `body` 的祖先链逐个过 `isSkipped` 与 `protectedAncestor`，规则与整页扫描一致（`pre`、可编辑区、`notranslate`、`hidden`、`inert`、`aria-hidden`、站点排除区域），任一命中就不处理，保证按住能译的段整页扫描也会发现。然后在文本节点**最小的块级祖先**上跑 `discoverUnits`，取包含该节点的单元；该祖先文字超过 20000 字时放弃。
- **对账**（toggleAt 的第一步）：重新 discover 得到的是新 Unit 对象，而 `rendered`（`render.ts:143`）和会话的各个集合（`session.ts:140`）都以 Unit 对象为键。所以先按「根元素 + kind + `seg.text` + `isCurrent`」与已注册单元对账，命中就用已有的 Unit。逻辑沿用 `session.ts:634-643` 的重扫对账，抽成共用函数。初始扫描还没注册完（`held` 未清空，`session.ts:842-848`）时忽略手势，避免同一段注册两次。
- 会话新增 `toggleAt(point)`：
  - 已译段 → 还原，并记入「不翻译此段」集合；重扫、重试失败都跳过它。
  - 已在「不翻译此段」集合里的段 → 移出集合并翻译。
  - 失败段 → 立即重试。
  - 未译段（视口外懒加载还没轮到，或被版面安全跳过）→ 立即翻译。
  - 过长（> 5000 字）的段 → 不处理。
- 「不翻译此段」集合：`WeakMap<Element, Set<string>>`，键是单元根元素，值是 `seg.text`。重扫会新建 Unit 对象，所以不能以 Unit 为键。重扫时保留；**用户明确停止（`page.stop` / 切换为停止）时清空**，之后重新开始就照常翻译，避免页面上没有任何标记、看起来像漏译。不持久化。
- 加载态：被按住触发的段落立即显示段末加载点（整页仍是 600 ms 后才显示）；失败沿用现有失败占位与重试。

**体积**：审查者按方案写的最小手势监听，在瘦身后的基础上测得 7.04 KB，还没算 `holdToggle` 路由与失联停止。**本 PR 申请把 content 预算从 7 KB 提到 7.5 KB**。

**测试**：手势状态机单测：按住到期触发且只触发一次；⌃Space 式的「Ctrl 按下又快速松开」不触发；Ctrl+C；Ctrl+滚轮；拖拽中按 Ctrl；按住 Ctrl 时点击链接；keyup 丢失后移动；输入法；可编辑区；坐标未知。会话单测：还原后重扫不复现；停止再开始仍不翻；失败段重试；视口外段立即翻译。e2e 3 条：按住还原再按住恢复翻译；Ctrl+C 不触发；还原后滚动触发重扫不复现。

### 5. 不开整页也能译段（`feat/hold-toggle-scoped`）
- **同一个会话，加 `scope: 'units' | 'page'`**，不新建第二种会话：
  - 没有会话时按住 Ctrl：加载 page-runtime，以 `scope: 'units'` 开始。`begin` 照常执行（固定引擎、记录目标语言、建渲染器、注入样式），`phase` 照常是 `running` / `done`，但不跑全量扫描、不开视口懒加载。
  - `PageState` 增加 `scope`。`scope: 'units'` 时灵岛不出现，工具栏状态点不点亮，面板仍显示「翻译此页」。以下按 `phase` 判断的位置都要改为同时看 `scope`：`session.ts` 的 `begin` 提前返回（`:776`）、状态上报（`:789`、`report()` `:206`）；`isle.ts:122`；面板 `App.tsx:111,401`；`page-session.ts:75`。
  - **升级**：`scope: 'units'` 时收到 `page.start` 或 `page.toggle`（面板、快捷键、右键菜单），改为 `scope: 'page'` 并开始全量扫描，**不走 `clearState`**。
    - `toggle`（`session.ts:905`）现在在 phase 不是 idle 时调 `stop`，改为 `scope: 'units'` 时升级。
    - `begin` 里换引擎的分支（`:762`）排在升级判断之后：`page.start({ engine })` 在局部会话下，先换引擎、再升级。
    - 全量扫描新建的 Unit 用第 4 节的对账函数与已渲染的对账，命中就沿用已有译文节点，不再插第二份。
    - 若当前目标语言已不同于局部会话开始时的目标语言，先清掉局部译文再升级。
  - **引擎级错误**：局部会话没有灵岛，`pause`（`session.ts:587-592`）撤掉加载点后，用户就看不到任何提示了。改为在 `scope: 'units'` 下，把引擎级错误显示在该段的失败占位上，文案沿用后台提供的 `userMessage`。
  - **停止**：`scope: 'units'` 时 `page.stop` 照常清除所有局部译文（现有 `stop` 在 idle 时直接返回，局部会话不再是 idle，可以正确清除）。
  - **模式**：局部译文跟随 `page.mode`，与整页一致；`setMode` 照常生效。
  - **动态内容**：`scope: 'units'` 照常挂变动监听，但只处理已渲染单元，文字变了就移除对应译文，不发现新单元。
- **测试**：会话单测：局部 → 升级不重复插入；改目标语言后升级；只有局部译文时 `page.stop` 能清除；局部状态下 `setMode`；局部译文所在节点文字变化后被移除；扩展失联 halt。e2e 2 条：不开整页按住译段，灵岛不出现；之后点「翻译此页」，该段不出现第二份译文。

### 6. 设置项（`feat/hold-toggle-setting`）
- 配置：`page.holdKey: 'ctrl' | 'alt' | 'off'`，默认 `'ctrl'`。在 `schema.ts`、`defaults.ts` 追加，并改 `src/lib/config/client.ts` 的 `normalizeConfig` 逐字段枚举校验；不升 `schemaVersion`。常驻层读配置，`off` 时不挂监听；配置变化时挂上或撤下。
- 不提供 Shift：Windows 中文输入法用单按 Shift 切换中英文，Shift 还用于扩选。
- Alt：在 Windows 上松开单独的 Alt 会把焦点移到 Chrome 菜单按钮。手势触发后，在这次的 `keyup` 上调用 `preventDefault`；真机验证无效时，Windows 上隐藏 Alt 选项。
- 设置页「网页翻译」卡片加一行下拉。拟定文案（三语，开工前请用户确认）：标签「按住切换段落翻译」；选项「Ctrl」「Alt」「关闭」，macOS 显示「⌃ Control」「⌥ Option」；说明「指针停在段落上，按住所选按键片刻，即可翻译或还原这一段。」

## 不做
- **仅译选区**：划词卡片已覆盖阅读选中内容的场景，原地译几段由按住切换覆盖；FluentRead 也未实现。有真实需求再立项。
- **按住扫过多段连续翻译**：Windows、Linux 用户按住 Ctrl 连点链接开新标签，或在网页应用里多选时，会误触。有反馈再加。
- **区域选择器**（翻译 / 不翻译此区域，↑↓ 扩缩）：需要键盘与指令体系，并入 M3c。
- **右键菜单新增项**：现有两项的 `contexts` 不重叠（`src/lib/context-menu.ts:35-45`）。Chrome 在同一场景下可见项超过一个时会折叠成父菜单，再加 `page` 项，「翻译此页」就要多点一次；Chrome 也没有 `onShown`，无法按状态动态隐藏。
- 「不翻译此段」持久化：按站点存 CSS 路径，站点改版即失效；与 `m3d.md` 决定 5 一致。
- 插入后测量溢出再撤回；用 `!important` 解除裁剪。

## 体积（需用户批准）
- **content**：PR3 瘦身省 0.41 KB，PR4 的手势监听加回后仍略超 7 KB。**申请提到 7.5 KB**（PR4 合并时生效）。
- **page-runtime**：现为 24.03 / 25 KB。PR1 约 +0.3 KB，PR2 约 +0.2 KB，PR3 移入约 +0.4 KB，PR4 约 +0.8 KB，PR5 约 +1.0 KB，合计约 26.7 KB。**申请提到 27 KB**（超出时按实测再申请，不悄悄调）。

## 最脆弱的假设
按住修饰键 400 ms 不会和用户已有习惯冲突。如果用户常常按住 Ctrl 犹豫后才按第二个键（例如慢速 Ctrl+C），或者按住 Ctrl 停留后再点链接，会先触发一次切换。被浏览器或系统截走第二个键的组合（Ctrl+Tab、Ctrl+T、⌃←、⌃Space），页面收不到第二个键，只能靠 400 ms 时长防误触。后果可逆，再按住一次就恢复；输入框内不触发；PR6 提供「关闭」。如果真机或反馈证实误触普遍，就把阈值调到 600 ms，或改为「双击修饰键」。触发判定集中在 `hold/watch.ts` 的一个函数里，可以单独替换。

## 回滚
6 个 PR 都只改代码与配置默认值，无数据迁移。`page.holdKey` 是追加字段，回滚后旧版按 `looseObject` 忽略。

## 验证
- **每个 PR**：`npm run check`（含体积、i18n、构建检查）全绿并贴结果；涉及页面行为的 PR 跑 `npm run test:e2e`。
- **真机**：PR1、PR2 请用户看 claude.dev 示意图页与一篇普通长文；PR4、PR6 在 macOS 上验证 ⌃Space、⌘ 组合、Ctrl+滚轮、Ctrl+点击，有 Windows 环境时验证 Alt。

## 附录 A：第 1 稿审查意见处理（2026-11-20，Opus）
| 意见 | 处理 |
|---|---|
| B1 「局部」会话与 PageSession 冲突（`session.ts:776-812`） | 改为同一会话加 `scope`，`phase` 照常；写明对账规则、改目标语言、停止、模式（第 5 节）；局部会话拆到 PR5 |
| B2 单按 Ctrl 被 ⌃Space、Ctrl+Space、Ctrl+滚轮、拖拽、Ctrl+点击误触 | 改为按住 400 ms、每次只触发一次；`wheel`、`pointerdown`、`buttons ≠ 0` 作废；本批不做扫过（第 4 节） |
| I1 剥符号丢语义、U+FE0F 残留 | 只剥纯分隔符，`✓ ✗ ★ * ⚠` 不动，补 emoji 变体选择符用例 |
| I2 「无字母」与代码不符 | 改为「去掉 verbatim 与 `role=img` 后过 `classifyText`」，保留 2 字母规则 |
| I3 版面安全判定位置太晚、条件误杀、集合键失效 | 移到 `want` 之前；删去弹性行 + `overflow:hidden` 条件；不用集合；「不翻译此段」改以根元素 + `seg.text` 为键并跨 `clearState` 保留 |
| I4 体积估计偏乐观 | 采用实测数字，直接申请 content 7.5 KB；page-runtime 估算计入 PR3 移入部分 |
| I5 瘦身有行为变化 | 写明行为变化、判断时机与测试搬迁 |
| I6 局部模式缺生命周期 | 先过 `protectedAncestor`；最小块级祖先 + 20000 字上限；失联时手势监听一起停；局部译文跟随模式，文字变化即移除 |
| I7 keyup 丢失 | 指针移动时校验 `event.ctrlKey`，忽略 `event.repeat` |
| S1 拆分 | PR1 拆为两个；悬停拆成会话内（PR4）与局部（PR5） |
| S2 `normalizeConfig` | 写入第 6 节 |
| S3 右键菜单 | 审查者确认理由成立，并补充了依据 |
| S4 FluentRead 路径 | 已改为带 `src/` 前缀的路径 |
| S5 测试 | 已补入各节测试 |

## 附录 B：第 2 稿增量审查意见处理（2026-11-20，Opus）
| 意见 | 处理 |
|---|---|
| 重要 1 toggleAt 拿到新 Unit，查不到已译状态；初扫未完成时可能重复注册 | 对账提前到 PR4，作为 toggleAt 第一步，复用 `session.ts:634-643` 逻辑；初扫未完成时忽略手势（第 4 节） |
| 重要 2 scope 影响面未列全（`toggle`、换引擎分支、状态上报、灵岛、面板） | 第 5 节逐项写明改法 |
| 重要 3 局部会话的引擎级错误无处显示 | 显示在段内失败占位上（第 5 节） |
| 重要 4 常驻层无法判定「同一段」 | 改为指针静止判定，移动超过 6 px 重新计时（第 4 节） |
| 重要 5 「不翻译此段」跨停止保留会像漏译 | 用户明确停止时清空；对已排除段按住则移出并翻译（第 4 节） |
| 重要 6 漏了块级截断（`truncate`） | 块级单元的 `ellipsis` + `nowrap` / line-clamp 也跳过（第 2 节） |
| 建议：样式读取器缺字段、`white-space` 继承、`ellipsis` 单独出现误判 | 第 2 节已改 |
| 建议：版面安全跳过的段按住无反馈 | 按住时照常翻译（第 2、4 节） |
| 建议：命中检查与整页扫描规则不一致 | 祖先链逐个过 `isSkipped` 与 `protectedAncestor`（第 4 节） |
| 建议：键盘事件无 `buttons`、`repeat`、切标签回来 | 第 4 节已写；被截走第二键的组合写进「最脆弱的假设」 |
| 建议：PR3 判断时机 | 新增 `autoStart()` 入口（第 3 节） |
