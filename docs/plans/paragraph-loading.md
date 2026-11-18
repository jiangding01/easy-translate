# 段落加载态方案

> 状态：已合并（#47，2026-11-18）。2026-11-18 用户批准。方案经 Opus 对抗式审查后修订。来源：`docs/reviews/2026-11-18-ux-triage.md` 第 1 节（用户同意排在样式精确恢复之后）。本方案推翻 `m2-page-translation.md` 附录 A「不做加载指示：页内不放占位」的决定，理由见下。

## 目标
整页翻译时，段落在视口内等译文超过约 600 毫秒，原文段末出现一个小加载点；译文（或失败占位）写入时在同一帧替换掉它。点「重试」后，失败占位立刻换成加载点，不再留空白。快的服务（Google 通常几百毫秒）基本看不到加载点。

## 为什么推翻「页内不放占位」
原决定的两条理由：Google 很快，指示会一闪而过；放占位再替换会造成两次跳动。现在接入大模型服务后单段可能数秒，用户分不清翻译中、跳过还是卡住；重试后失败占位被移除、重发期间原位空白（`session.ts:485-492`）。延迟 600 毫秒才出现，快服务不受影响；加载点是行内小圆点，实测在不折行的段落里出现时不引起任何位移（见「滚动与布局实测」），替换成译文时的位移与现在直接插入译文完全相同。

## 参考
FluentRead（`src/ui/translationLoadingIndicator.ts:105-132`、`content/loadingIndicator.ts:12-36`、`runtime.ts:373-376, 492-496`）：整页翻译延迟 180 毫秒才显示；宿主 `aria-hidden`、无文字、`contain: layout style paint`、固定尺寸；减少动态效果时静态；译文或失败提示写入时在同一次事务里移除加载点。我们取它的形态（无文字、aria-hidden、contain、同帧替换）；延迟取 600 毫秒（目标是慢服务，快服务不打扰）；它每次插入都手动锚定视口，我们不做（见「滚动与布局实测」）。

## 方案
1. **DOM 与样式**（`render.ts`、`styles.ts`）
   - 加载点为 `<et-tr data-et-state="loading" aria-hidden="true" translate="no" lang="界面语言">`，无文字（不新增文案；整页进度已有灵岛的读屏播报）。**不复用** `makeElement`，不带 `data-et-s` 与 `data-et-inline`，避免译文样式（`display:block`、margin、highlight 背景、faded 透明度，`styles.ts:12-19`）叠到圆点上。
   - 插入位置复用 `place()`：块单元在原文元素末尾、行内片段在最后节点后、flex/grid 根在最后一段文字后，与译文和失败占位同位。
   - 单独一条 `et-tr[data-et-state="loading"]` 规则：`display:inline-block`、约 0.5em 圆点、`margin:0 0 0 .3em`、`vertical-align` 对齐文字中线、`contain: layout style paint`、`pointer-events:none`、品牌琥珀色（浅色 `oklch(0.52 0.12 60)`，深色宿主沿用失败占位的深色判断方式）、1.2 秒透明度呼吸动画；`@media (prefers-reduced-motion: reduce)` 下无动画、固定透明度。
   - 加载点**不进** `rendered` 表，单独 `loadings: Map<Unit, { el, token }>`，不会被 `has` / `canBeOnly` / `detached` / `setMode` 当成译文或可隐藏原文的段落。
2. **渲染器接口与守卫**
   - `showLoading(unit): Promise<void>`：同步登记一个新的序号，然后与 `insert` / `fail` 一样等下一帧写入；写入前检查「登记仍是这个序号、`!has(unit)`、`!disposed`」，任一不满足就放弃。若该单元有失败占位，写入时 `detach` 并 `rendered.delete(unit)`（只移除元素会让 `detached()` 误判为被框架删掉的译文，触发 forget、重扫，3 次后整段被放弃）。
   - `hideLoading(unit): void`：作废登记，有元素就移除。
   - `insert`、`fail` 同步作废该单元的登记，并在各自写阶段移除已存在的加载点元素（与译文同帧替换）；`drop`、`restoreAll` 同样清掉。
3. **会话逻辑**（`session.ts`）
   - 不变式：单元处在 `pending`、`sent`、`waiting` 之一才算「未完成」。`want()` 把单元放进 pending 时、`retry()` 时记 `wantedAt`（已有则保留原值）。
   - **固定间隔扫描**：只要有未完成单元且会话在运行（同一 `epoch`、未 `halted`、无 `engineError`），每 300 毫秒扫一次，没有未完成单元就停。扫描对 `visibleRoots` 内的单元：未完成、`wantedAt` 已过 600 毫秒、根元素与真实视口相交（`getBoundingClientRect` 与 `innerHeight` 相交，不是 1000px 预取边距）且尚未显示的，`showLoading`；已显示但不再未完成（得到译文的除外，见下）或已出视口被移出 pending 的，`hideLoading`。滚动进来的段落最多 300 毫秒内出现，不需要额外的 scroll 监听。
   - **回包时不碰 DOM**：得到译文或失败时，会话只删除 `wantedAt`，加载点由 `insert` / `fail` 的写阶段替换，保证同帧。放弃（`settled`，非 translated）、`forget`、`clearState` 时 `hideLoading`。
   - 引擎错误暂停（`pause`）和 `halt`：隐藏所有加载点，扫描停止（不会再有回包，灵岛显示错误）。暂停解除（`retryFailed` 或「这次先用」换引擎的 `begin`）后沿用原 `wantedAt`，下一次扫描即显示。
   - 重试：`retry()` 不再 `renderer.drop`，改为直接 `showLoading`（不等 600 毫秒，用户刚点了按钮需要立即反馈）。
   - 延迟与扫描间隔作为 `SessionDeps` 的可选项注入（默认 600 / 300，只为测试，不是用户配置）；视口相交判断沿用会话里已有的读法并允许测试打桩。
4. **对外 DOM 约定**：`docs/dom-contract.md` 表格 `et-tr[data-et-state]` 一行由「目前只有 error」改为「error、loading」；CHANGELOG 标「DOM 约定补充（兼容）」：`:22` 已预留「加载中」，按「删掉所有 data-et-state」处理的导出工具自然覆盖。`render.test.ts`「DOM contract」锁定用例补上。
5. **不改**：灵岛、面板、文案、缓存路径（缓存命中走同一回包路径，通常远快于 600 毫秒）。

## 滚动与布局实测（审查时在 Chrome for Testing 纯 DOM 页面完成）
- 视口**上方**插入块级译文：浏览器原生滚动锚定完全补偿，视口内容不动。
- 视口**内**插入块级译文：原生锚定只保住视口顶部那段，读者正在看的下方段落会被推下。这是现有双语插入的固有行为，与加载点无关；若改成每次插入都手动锚定，会改变现有产品行为并在每帧多一次 `elementFromPoint`，不在本方案范围。设计文档「插入后由阅读位置锚定兜底」的说法据此更正。
- 行内圆点在不折行的段落里出现时零位移；已有圆点同帧换成译文，位移与直接插入译文相同。约 3/120 的段落末行满时圆点会折到新行。
- 结论：本 PR 不做手动锚定，只用 e2e 锁定「视口上方插入不移动视口内容」与「圆点出现不改变无折行段落的高度」。

## 不做
- 加载点上的文字或读屏播报；进度数字、骨架占位、预留高度；缓存命中标识（`ux-triage.md` 第 3 节）；划词卡片（已有骨架扫光）；手动视口锚定（见上）。

## 测试
- `render.test.ts`：`showLoading` 插入 `et-tr[data-et-state="loading"][aria-hidden="true"]`、无文字、无 `data-et-s`、`lang` 为界面语言、位置与译文一致（块、行内片段、flex/grid）；`insert` 同帧替换加载点且最终只有一个 `et-tr`；`fail` 替换加载点；`showLoading` 替换失败占位后 `rendered` 不再有该单元、`has()` 为假；`showLoading` 尚未写入时 `insert` 先到，最终没有圆点（竞态）；`drop`、`restoreAll` 清掉加载点；DOM contract 用例补 `loading`。
- `session.test.ts`（注入短延迟与间隔；对根元素位置打桩，同一用例里放视口内与仅在预取边距内的单元）：
  - 视口内待译单元超时后出现加载点，回包后被译文替换；仅在预取边距内的不出现；
  - 回包早于延迟则**从未**出现（用 MutationObserver 记录，不只看最终状态）；
  - 放弃、失败、forget、出视口被移出 pending、`stop`、引擎错误暂停后加载点消失，暂停期间从未重新出现；暂停解除后出现；
  - 点重试后立即出现加载点（无需等待），回包后被译文替换；重试后触发一次页面变动，单元仍在、不被放弃。
- e2e（`harness.ts` 的 Google mock 支持返回 Promise：`fulfillGoogle` 改为 async、等所有段落的结果；挂起的请求在用例结束时放行）：
  - 慢回包时段末出现加载点，放行后换成译文，页面只剩译文；
  - 失败后点重试，原位立即出现加载点，回包后换成译文；
  - 视口上方插入译文不移动视口内段落（锁定原生锚定）；
  - 圆点出现不改变无折行段落的高度。
- 变异验证：去掉扫描定时器 →「超时出现」变红；`retry` 改回 `drop` →「重试后立即出现」变红；去掉 `showLoading` 写阶段的 `has` 检查 → 竞态用例变红；`showLoading` 替换失败占位时不 `rendered.delete` →「重试后不被放弃」变红。
- 命令：`npm run lint`、`tsc --noEmit`、`npm test`、`npm run build`、`node scripts/check-size.mjs`（page-runtime 22.31 / 24 KB，预计 +0.6–0.9 KB；content 不得变化）、`npm run test:e2e -- --retry=0` 连跑 3 次。
- 手工：临时调大 mock 延迟，看加载点外观、深色站点、减少动态效果。

## 文档
本方案（落地后补实施记录）；`m2-page-translation.md` 附录 A 那行改为「已推翻，见 paragraph-loading.md」；`docs/plans/ui-isle-direction.md` 「插入后由阅读位置锚定兜底」更正为实测结论；`docs/dom-contract.md`；`docs/reviews/2026-11-18-ux-triage.md` 修正「FluentRead 无延迟」为「整页翻译延迟 180 毫秒」、dom-contract 行号更正为 `:22`；`e2e-smoke.md`；CHANGELOG（新功能 + DOM 约定补充）；HANDOFF。

## 最脆弱的假设
「圆点多数情况下不影响布局」。段末满行（实测约 3/120）、段末 `<br>`、flex column 根会让圆点单独占一行，出现时多一次跳动；line-clamp 或省略号会把圆点藏住。缓解：只在等待超过 600 毫秒才出现，快服务从不触发；替换同帧完成。若手工验收发现跳动明显，可改为绝对定位在段末（需给根元素加定位上下文，侵入更大，默认不采用）。

## 回滚
revert 本 PR；只改内容脚本渲染与会话逻辑、e2e harness，不涉及存储与数据。

## 分支
`feat/paragraph-loading`

## 分工
Sonnet 按方案实现与补测试（会话计时部分涉及时序，若 Sonnet 两轮未过则升级 Opus）；主会话验收（变异验证、e2e 连跑、体积）后走 check 审查循环。

## 实施记录（2026-11-18）

分支 `feat/paragraph-loading`，Sonnet 按方案实现，主会话验收，经两轮 check 审查。

### 实现要点
- `render.ts`：新增 `showLoading` / `hideLoading` / `hideAllLoading`。加载点为 `<et-tr data-et-state="loading" aria-hidden="true" translate="no" lang=界面语言>`，无文字，不进 `rendered` 表。`showLoading` 同步登记序号，下一帧写入前检查序号仍有效、`!has`、`!disposed`；替换失败占位时先 detach 并 `rendered.delete`。`insert`、`fail` 同帧替换加载点；`drop`、`restoreAll`、`fail` 遇到根节点已脱离时清除加载点。`inViewport` 导出，供会话复用。
- `styles.ts`：单独一条规则，0.5em 琥珀圆点、`inline-block`、`contain`、1.2 秒呼吸动画；深色宿主（`data-et-host="dark"`）换深色琥珀；`prefers-reduced-motion` 下静态。
- `session.ts`：`wantedAt`；固定 300 毫秒扫描（只在有未完成单元时运行），单元在真实视口内等待超过 600 毫秒才显示。回包不碰 DOM。放弃、`forget`、出视口、请求已 done 但未回包的单元会 release；`pause`、`halt` 隐藏全部加载点（`halt` 调 `renderer.hideAllLoading`）；`retry` 立即显示加载点。
- `mutations.ts`：新增可选项 `ignoreRemoved`，会话传入「是否加载点」的判断，替换加载点不再触发页面重扫。
- 测试：`render.test.ts`「renderer: loading dot」等、`session.test.ts`「page session: loading dots」等、`mutations.test.ts` 新增 1 条；e2e 新增 `tests/e2e/loading.e2e.test.ts` 4 条（慢回包出现加载点后换成译文；失败后重试立即出现加载点；视口上方插入不移动视口内段落，锁定原生锚定；圆点不改变一行段落高度）；`harness.ts` 的 Google mock 支持返回 Promise。

### 与方案的差异
- `retry` 在 `halt` 之后与引擎暂停期间不显示加载点（方案只写了 `pause` 与 `halt` 隐藏；第 1 轮审查发现 `halt` 后重试会残留圆点，补了守卫）。
- `mutations.ts` 新增可选项 `ignoreRemoved`（方案未列）：替换加载点本身是一次节点移除，不加会触发页面重扫。
- `inViewport` 复用时含横向判断（方案只写纵向）：第 1 轮审查发现只判纵向会让横向滚出的单元仍显示圆点。
- 变异验证里，「只去掉显示前的视口判断」是等价变异：扫描第二步会在写入前按视口取消，单独去掉不会改变行为；同时去掉两处才变红。

### check 审查
- 第 1 轮（Opus 深度对抗审查）发现并已修复：替换加载点触发页面重扫；`halt` 后重试残留圆点；`halt` 时待渲染单元残留；请求 done 但未回包时扫描空转；失败时根节点脱离残留；视口只判断纵向；另有三处空过测试（去掉被测逻辑后仍通过）已改为真正会红。
- 第 2 轮只审修复增量，无阻断问题。

### 变异验证
去掉扫描、`retry` 改回 `drop`、去掉 `has` 检查、不 `rendered.delete`、`pause` 不隐藏、`insert` / `fail` / `drop` / `restoreAll` 不清除、去掉 `ignoreRemoved`、去掉 `retry` 的 `halted` 守卫、`halt` 只清已显示的、去掉暂停守卫，对应用例均变红。「只去掉显示前的视口判断」为等价变异（见上）。

### 体积
page-runtime 22.31 到 23.10 KB（预算 24）；content 6.99、selection-runtime 18.17 不变。

### 验证
- `npm run lint`、`tsc --noEmit`、`npm test`（76 文件 1536 用例）、`npm run build` 通过。
- `npm run test:e2e -- --retry=0` 多次连跑：24 通过、2 跳过（macOS；CI 的 Linux 预期 26 通过）。
- 手工验收（调大 mock 延迟看外观、深色站点、减少动态效果）未做，合并前请用户点一遍。
