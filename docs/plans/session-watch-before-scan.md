# M3d PR-B2：先监听后初扫，初扫期间的新内容不漏、不并块

> 状态：已合并（#55，2026-11-19）。方案经 Opus 对抗式审查后修订，用户批准。总方案见 `docs/plans/m3d.md`（B2 行）；问题核实见 `docs/reviews/2026-11-17-core-findings-verification.md` 第 3 条及「配置订阅晚于初扫」。

## 问题（行号为 main `9102dc9`）
1. **初扫与监听之间的空窗**（Codex 第 4 条）：`session.ts` `begin()` 先 `await discoverUnits(doc.body)`（:802），扫完 `register`（:808）后才 `watch`（:813）。初扫是分片的（`discover.ts:30-48`，8ms 一片，`scheduler.yield` 让出），扫描期间页面插进**已扫过**的容器的内容，既不在初扫结果里，也没有监听器记录，永远不翻译。
2. **配置订阅晚于初扫**：`watchConfig` 在 :825 才订阅，读配置（:781）到扫完之间用户改的译文样式丢失，直到下次再改。
3. **追加到未扫完容器的新块被并进行内 run**（核实文档第 3 条的附带发现）：`discoverUnits` 进入元素时对子元素做快照压栈（`discover.ts:83-87`），退出时却读实时的 `el.children` / `el.childNodes`（:92、:103、:114）。父元素进入之后才追加的子元素没被访问过，`blockish.get(child)` 为 `undefined`，被当成行内：
   - 父元素已有块子元素时，新块在 :117 被推进 run，发送 `<t0><t1>New heading</t1><t2>New body</t2></t0>`，译文插错位置、排版错乱；
   - 父元素原本没有块子元素时，在 :103 整个父元素成为一个 block 单元，把新块包进去。
   这条在 rescan 里同样存在（rescan 也分片）。

**只做「先监听」修不了第 3 条**（Opus 调研实测）：缓存的脏元素扫完后 rescan 父容器时，错误的 run 的 root 是父容器本身，若父容器不是本轮新找到的单元的 root，`mayBeHidden` 为真（`session.ts:643`），错 run 仍满足 `isCurrent`，被保留，结果错 run 与正确的两个块都发送，同一内容译两遍。必须同时改 `discover.ts`。

## 方案（只改 page-runtime：`session.ts`、`discover.ts`）
1. **discover 边界补丁**（`discover.ts:93`、`:117`）：把「未访问过、且不属于 `isSkipped` 的子元素」当成块边界，但**只对非行内的父元素**这样做：
   - 退出元素时先算 `selfInline = el !== root && inline(el)`；`:93` 的 `childBlockish` 判断改为 `blockish.get(child) ?? (!selfInline && !isSkipped(child))`；
   - `:117` 改为 `blockish.get(childEl) ?? !isSkipped(childEl)`（能走到 :117 的父元素已是块）。
   - 行内父元素忽略未访问的子元素（与原来一致）。否则扫描中往 `<p>` 里的 `<a>` 追加 `<svg>` 会让 `<a>` 变成独立 block 单元；rescan 从 `<a>` 上溯到 `<p>` 时，旧 a 单元的 root 不在本轮找到的 root 里，`mayBeHidden` 为真且 `isCurrent` 仍为真，被保留，链接文字译两遍（审查发现）。
   - 静态 DOM 下这是空操作：未跳过的直接子元素在退出父元素前一定已被访问、`blockish` 有值（超过 `MAX_DEPTH` 的设为 `true`）；跳过的仍为 `undefined`，`?? !isSkipped` 得 `false`，与原来一致，:117 后半的 `isSkipped && !inline` 不变。`isSkipped` 只看属性，不依赖 `readStyle`。
   - 扫描期间追加到块级父元素的子元素被当作边界，不会并进 run，也不会让父元素整个变成 block。它本身由监听器记录、扫完 rescan 时正常发现。
   - 代价：扫描期间往块级段落里补的是行内元素（如 `<span>`）时，段落会先被拆成两个 run；rescan 该段落时 root 在本轮找到的 root 里，`mayBeHidden` 为假，两个旧 run 被遗忘、换成正确的 block，多一次请求。只在「初扫或 rescan 进行中恰好改了正在扫的元素」时发生。
2. **先监听、扫描期间缓存**（`session.ts` `begin()`）：
   - `watch(...)` 挪到 `discoverUnits` 之前（setMode 与视口之后），赋给 `stopWatching` 后再 await，`stop`、`halt` 与 catch→stop 都能清理。
   - `begin()` 内局部 `let pending: Element[] | undefined = []`。`onDirty`：`pending` 有值时只 `pending.push(...elements)` 并返回；否则照旧（换新 `readStyle`、`void rescan(elements)`）。
   - `register(units)` 与随后的 `notify()`/epoch 检查之后：取出 `pending` 并置 `undefined`；非空时换新 `readStyle`，`void rescan(pending)`。不另做包含去重：rescan 的 roots 已是 `Set`，相互包含的根依次处理时，后一个按 `kept` 匹配保留已注册单元，请求数不变，去重只省一次扫描（审查确认），不值得多写代码。
   - 不用 B（扫描期间直接并发 rescan）：调研实测会产生重复单元，同一段发两次、DOM 出现两个 `et-tr`（初扫 `register` 无去重）。不用 FluentRead 的串行队列（D）：要把 rescan 改成队列、初扫走同一路径，改动和体积明显更大；本 PR 只关空窗。
3. **配置订阅提前到读配置之前**：
   - 在 `await deps.getConfig()` 之前订阅（`stopWatchingConfig` 在 await 前赋值）。回调：epoch 不对就返回；renderer 还没建好时只记 `style = next.page.style`；建好后与现有逻辑相同（样式变了才 `setStyle`）。
   - 只有 `style` 这一个变量：建 renderer 时 `style ??= config.page.style`，renderer 建好前的回调只记值。
   - 正确性：订阅早于读取，`onChanged` 与 `get` 无论谁先到，最终都是最新值生效（`get` 发出在写入之前则返回旧值、随后 `onChanged` 带来新值；发出在写入之后则返回新值，`onChanged` 若到也是同值）。`watchConfig`（`client.ts:117`）推送完整的归一化配置，订阅时不同步回调；`selection/watch.ts:211` 已是先订阅后读取的写法。
   - `stop()` 里的 `stopWatchingConfig?.()`（`session.ts:844`）照 `halt` 的写法包 try：订阅提前后，读配置失败（多因扩展上下文失效）会经 catch→`stop()` 退订，`removeListener` 此时可能抛错，不包会让 `stop()` 中断、phase 停在 `running`。
4. **不改**：`mutations.ts`、`render.ts`、常驻 content、文案、存储。

## 已知限制（不在本 PR 修）
- 扫描期间脏元素超过 32 个时，`mutations.ts` 合并成 `[body]`，扫完相当于整页再扫一次（大页面初扫成本翻倍，结果正确）。
- 多轮 `onDirty` 的 rescan 之间仍可能并发（`void rescan`，现状如此，读代码推断、未复现）；彻底消除需要串行队列，留给以后有真实问题时再做。
- 真实 Chrome 中 `scheduler.yield` 的续体优先于页面 `setTimeout`，防抖定时器多半在扫完后才触发，onDirty 落在扫描期间主要发生在 happy-dom 与长扫描；两条路径都按上面处理。

## 测试
- **`discover.test.ts`**：
  - 父元素有块子元素，扫描中途（`readStyle` 读到某个 SPAN 时同步追加 `<div><div>A</div><div>B</div></div>`）：结果里没有包含新块文本的 run；
  - 父元素原本只有行内内容，扫描中途追加块：父元素不成为包含新块的 block 单元；
  - 扫描中途向 `<p>` 里的 `<a>` 追加 `<svg>`：`<a>` 不成为独立单元，`<p>` 仍是一个 block（行内父元素不受补丁影响）；
  - 现有用例全部不改、全部通过（静态 DOM 下补丁是空操作）。
- **`session.test.ts`**（`setup(..., extra)` 覆盖 `createReadStyle` 与 `createMutationWatch`；假 watch 保存 options，在 `readStyle` 钩子里同步调用 `onDirty`，不依赖定时器。钩子只触发一次，避免嵌套扫描时反复追加；还没拿到 watch 的 options 时只改 DOM、不调用，这样「watch 挪回扫描之后」的变异是因断言变红而不是因抛异常）：
  - 初扫期间向**已扫完**的容器插入段落：扫完后该段落被发送并翻译（Codex 场景）；
  - 初扫期间向**未扫完**的容器追加块：发送的是两个独立块，没有 `<t0><t1>…</t1><t2>…</t2></t0>` 形态；统计全部请求项（含原有文本），每段文本只发一次；
  - 初扫期间往 `<a>` 里追加 `<svg>` 后 rescan：链接文字只随整段发送一次；
  - 扫描期间 `stop()`：之后 onDirty 不触发 rescan、监听已取消；
  - 读配置期间（`getConfig` 挂起）经 `watchConfig` 推新样式：放行后 renderer 用新样式；扫描期间推新样式：同样生效；
  - 读配置失败且退订抛错：`stop()` 仍完成，phase 回到 idle。
  - 测试 fake 的退订（`session.test.ts:96` 的 `splice(indexOf(...), 1)`）加 `indexOf >= 0` 防护，避免重复退订误删其他监听。
- **e2e 第 19 条**（`session.e2e.test.ts`，启用 `e2e-smoke-pr2.md` 中搁置的第 19 条）：
  - harness（`tests/e2e/harness.ts`）新增：监听页面会话的 `Runtime.executionContextCreated`，只记主 frame（`auxData.frameId`）上 `auxData.type === 'isolated'` 且 origin 为 `chrome-extension://<extensionId>` 的 contextId，处理 `executionContextDestroyed` 与 `executionContextsCleared`；暴露 `evalInContentWorld(expression)`，先用 `waitFor` 等 context 出现（内容脚本在 document_idle 注入，`openPage` 返回时可能还没有），再 `Runtime.evaluate({ contextId })`。扩展 id 用 harness 已有的 `extensionId`，只在测试侧，不进产品代码。约 20 行。
  - 用例在开始翻译前，在内容脚本的隔离世界里包装 `globalThis.scheduler.yield`，第一次调用时插入（只影响隔离世界，页面主世界不可见，调研实测 `mainWorldOverridden: false`）。fixture 用约 6000 段，保证初扫至少让出一次；用例断言「插入发生时 `et-tr` 数为 0」证明确实在初扫中途。
  - 两条，插入点都在首屏：
    - 插入**已扫完**的容器：该容器在文档最前、体积很小，断言插入的段落被翻译；
    - 用 `body.prepend` 插入含两个块的容器（body 此时已进入、未退出，即「未扫完容器」；追加到末尾会在视口外、不发送），断言两个块各自有译文、请求里没有包住两块的单元。
  - 调研在 Chrome for Testing 158 上实测 3/3 复现修复前的漏翻。
- **变异验证**：
  - 去掉 discover 补丁（恢复 `blockish.get(x)`）→ 未扫完容器的单测与 e2e 变红；
  - `watch` 挪回扫描之后 → 已扫完容器的单测与 e2e 变红；
  - 去掉 `pending` 缓存、扫描期间直接 rescan → 「每段只发一次」变红；
  - 补丁去掉 `!selfInline` 条件 → `<a>` 追加 `<svg>` 用例变红；
  - 订阅挪回 renderer 之后 / 建 renderer 时不用已记下的 `style` → 读配置期间改样式用例变红；
  - `stop()` 退订去掉 try → 退订抛错用例变红。
- **命令**：`npm run check`、`npm run test:e2e -- --retry=0`（新用例连跑 5 次）。

## 体积
page-runtime 当前 23.23 / 24 KB，预计增加不到 0.2 KB，贴实测。content 不变（6.99 / 7.00）。

## 文档
本方案（实施记录）；`docs/plans/m3d.md` B2 行补 PR 号与「已合并」；`docs/plans/e2e-smoke-pr2.md` 第 19 条由「不做」改为已在本 PR 启用，`docs/plans/e2e-smoke.md` 第 47、59 行第 19 条的去向同步；`docs/reviews/2026-11-17-core-findings-verification.md` 第 3 条与「配置订阅晚于初扫」的状态，更正第 34 行「提前注册观察器可一并修掉并块」的说法与第 50 行的处置描述；`docs/reviews/2026-11-18-codex-review-verification.md` 第 4 条状态；CHANGELOG（修复：开始翻译时页面正在加载的新内容不再漏翻；动态追加的多个段落不再被并成一段翻译；开始翻译时改的译文样式立即生效）；HANDOFF。均写成合并后的终态。

## 回滚
revert 本 PR；只改 page-runtime 的会话启动顺序与 discover 边界判断，不涉及存储与数据。

## 分支
`fix/session-watch-before-scan`

## 实施记录（2026-11-19）
**实现**（均按方案）：
- `discover.ts`：退出元素时，未访问且未跳过的子元素当作块边界，行内父元素除外；静态 DOM 下是空操作。
- `session.ts`：`watch` 挪到 `discoverUnits` 之前，扫描期间的脏元素缓存在局部变量 `held`，`register` 之后统一 `rescan`；配置订阅提前到读配置之前；`stop()` 里退订包 try。
- harness：新增 `evalInContentWorld`，在内容脚本的隔离世界执行脚本，并能包装 `scheduler.yield` 作为暂停点。
- 测试：见下。

**与方案的差异**：
- 配置订阅只用一个 `style` 变量（check 建议），renderer 建好前回调只记值，建 renderer 时 `style ??= config.page.style`，省掉 `latestStyle`。
- e2e 的 6000 段 fixture 在用例里用 `h.evaluate` 替换 `e2e-article.html` 的 body 生成，没有新增 fixture 文件，也没有叠加 CPU 降速。
- 「扫描中停止」单测只断言监听已取消，另一半断言恒成立，已删。

**测试**：`discover.test` 新增 3 条，`session.test` 新增 7 条，`session.e2e` 新增 2 条（`during the first scan`：已扫完容器插入段落被翻译；`body.prepend` 两块各自翻译、`body > et-tr` 为 0）。修复前复现：恢复 main 版本的 `session.ts` 与 `discover.ts` 后，单测红 7 条，两条 e2e 均红；另 3 条为防回归用例，靠变异验证。

**变异验证**：方案列出的 6 条变异均变红。

**体积**：page-runtime 23.23 到 23.27 KB（上限 24），content 6.99 KB 不变。

**验证**：`npm run check` 退出码 0（1571 个用例）；e2e 全套 `--retry=0` 全绿，新增两条连跑多次全绿。

**check 结论**：第 1 轮（Opus 审）无阻断问题；1 条应改（过时注释）与 4 条建议（变量同名遮蔽改名 `held`、去掉 `latestStyle`、`isBlockish` 少一次 inline 调用、3 处可能空过的断言）均已修复。第 2 轮只审修复增量，无新问题。
