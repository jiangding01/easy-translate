# M3d PR-E：单页应用切换路由（e2e 与整页重扫冷却）

> 状态：已合并（#PRNUM，2026-11-19）。方案经 Opus 对抗式审查（阻断 2 条）后按实测数据重写、复审无阻断，用户批准。总方案见 `docs/plans/m3d.md`（E 行）。另含过长段落的手工验收页（PR-C #57 合并后用户未找到真实页面验收）。分支由 `test/spa-route-e2e` 改为 `fix/spa-route-cooldown`（含产品修复，仓库惯例不用 `test/`）。

## 实测结论（行号为 main `cf85c33`）
探针 e2e `tests/e2e/spa-route.e2e.test.ts`（9 条，两轮全过、未触发重试）覆盖：

| # | 场景 | 结果 |
|---|---|---|
| a | `pushState` 后 `main.replaceChildren(...)` | 新段落译出；旧文本不再进请求；translated 等于当前段数 |
| b | `main.replaceWith(newMain)` | 同上，页眉不重发 |
| c | 路由间切换超长段 | skipped 1 → 1（占位 1 个）→ 无键，超长文本从未发出 |
| d | 旧路由请求在途时切换 | 迟到译文被丢弃（`session.ts:485` 按 id 找不到已遗忘单元），无孤儿 `et-tr` |
| e | `history.back()`，页面路由器重渲染 | 重新译出（会话内存命中），计数正确 |
| f | 只看译文模式下切换 | 新段落带 `data-et-only`，无残留 |
| g | 保留 `<p>` 只改文本（React 式），只看译文 | 段数变少时多余单元被遗忘 |
| h | 两个路由来回切 3 轮 | 不触发 `allowReinsert` / `abandoned` |
| i | 原地改写 40 段（超过 `burstLimit` 32） | 走整页重扫，正确 |

**没有正确性缺陷，测出两处冷却问题**（打点测量，单位 ms，「首请求 / 全部译完」，`go(path, 'text')` 原地改写 40 段，从 /many1 连续切到 /many2 至 /many5）：

| 状态 | /many2 | /many3 | /many4 | /many5 |
|---|---|---|---|---|
| 现状，连续切 | 365 / 430 | 1950 / 2050 | 3900 / 3950 | 3930 / 4070 |
| 现状，每次间隔 2.5s | 365 / 419 | 3450 / 3565 | 1385 / 1480 | 1570 / 1680 |
| 只做修复 1，间隔 2.5s | 365 / 417 | 378 / 515 | 1350 / 1467 | 1384 / 1511 |
| 修复 1 + 2，连续切 | 365 / 419 | 950 / 1058 | 892 / 952 | 939 / 1051 |
| 修复 1 + 2，不改 URL 连续改写 | 362 / 415 | 1950 / 2018 | 3935 / 4001 | 3935 / 3990 |

1. **扩展自己删旧译文会触发一次多余的整页重扫**：整页重扫后，`rescan` 遗忘旧单元，`forget` → `renderer.drop` → `detach`（`render.ts:378` `record.el.remove()`）在 40 个 `<p>` 上各删一个 `et-tr`。这些删除不在 `ignoreRemoved` 里（`session.ts:709`、`:830` 只忽略加载点），按 `mutations.ts:66-70` 算有效变动，40 个 `<p>` 再次变脏，超过 `burstLimit`，冷却后再整页重扫一次，冷却等级白升一级。打点确认每次整页重扫后 2 至 4ms 出现 40 条「只删了 et-tr」的记录。
2. **路由切换本身让冷却逐级升高**：整页重扫冷却 1s → 2s → 4s，静默 10s 才归零（`mutations.ts:19-20`、`:39-51`）。冷却是为了挡住持续大范围变动的页面（行情、动画），但连续切页的用户第 3 页起要等约 4s。冷却在 `onDirty` 之前发生，m3d 原定的「在 `onDirty` 里比较 `location.href`」解决不了；而且冷却定时器已排队时（`:43-45`、`:76` 只在没有定时器时起防抖），新变动只能等原定时器到点。

第一次切换约 0.4s：会话里第一次整页重扫没有冷却。

## 方案
1. **自家删除的 `et-tr` 不计入变动**（修复 1）：
   - `render.ts`：每个 renderer 内部一个 `WeakSet<Node>`；`detach` 删除仍在页面上（`isConnected`）的 `et-tr` 前把它加入（`detach` 的 5 个调用点 `:468`、`:538`、`:615`、`:645`、`:706` 都是我们主动删除，都不需要触发重扫）；renderer 暴露只读判断 `removedByUs(node): boolean`。加载点由 `clearLoading` 删除、不经过 `detach`，原有的加载点判断保留。
   - `session.ts`：创建 watch 时的 `ignoreRemoved`（`:830` 附近）改为「加载点 或 `renderer.removedByUs(node)`」。
   - 框架删掉的 `et-tr` 不经过 `detach`，照样被发现、照样恢复（`allowReinsert` 路径不变）。
2. **路由变化时冷却降到最低一级**（修复 2，`mutations.ts`）：
   - `MutationWatchOptions` 加可选 `routeKey?: () => string`；`watchMutations` 启动时记 `lastRoute = routeKey?.()`。
   - 整页分支（`dirty.size > burstLimit`）里：若 `routeKey` 存在且返回值不等于 `lastRoute`，`broadLevel` 归零（冷却取 `COOLDOWNS[0]` 即 1s，从上次整页重扫算起），记下新 `lastRoute`。不降到 0：`onDirty` 不等 `rescan` 结束（`session.ts:838` `void rescan`），保留 1s 下限避免大页面上多次整页重扫叠跑。其余行为不变。
   - 冷却等待改为分段：`timer = setTimeout(fire, Math.min(debounceMs, cooldown - elapsed))`，每次醒来重新走 `fire()`，冷却期间换了路由能当场处理；没有换路由时只是多几次「集合大小检查」后继续等。
   - `lastRoute` 只在整页分支里更新（检测到路由变化就更新，包括随后仍需等待下限的情况）：框架先改骨架（小范围、URL 已变）后到正文（大范围）时，正文那次仍认得出是新路由。
   - **路由键**：`mutations.ts` 导出纯函数 `routeKeyOf(loc: Pick<Location, 'pathname' | 'search' | 'hash'>): string`，返回 `pathname + search`，hash 只在以 `#/` 或 `#!` 开头（hash 路由）时追加。`session.ts:827` 创建 watch 时传 `routeKey: () => routeKeyOf(win.location)`（`win` 即 `deps.win`，`session.ts:104`）。文档站滚动时用 `replaceState` 改 `#章节` 不算换页。
   - 不加监听，不包 `pushState`；只在整页分支判断时读 location（冷却等待期间每个 `debounceMs` 读一次）。
3. **e2e**：探针 a 至 i 保留为正式用例，修两处：d 的断言要求 `/next` 的 4 个标记各自满足「恰好一个 `et-tr` 且不是状态占位」（现写法会把加载点算进去，可能空转）；`:190` 的 `message` 在调用时就求值、永远为空，删掉。路由表补 `/many3`、`/many4`，避免命中会话内存。
4. **手工验收页** `tests/fixtures/too-long-paragraph.html`，样式与说明方式照 `translation-only-layout.html`：
   - 文件头注释：对应 `docs/plans/skipped-count.md` 与 `docs/dom-contract.md`；内容脚本只在 http/https 运行，先 `python3 -m http.server 8765 --directory tests/fixtures`，再开 `http://localhost:8765/too-long-paragraph.html`；验收步骤：翻译整页 → 看段末提示 → 开面板看计数 → 切只看译文 → 切回双语 → 点动态按钮 → 停止。
   - 超长文本用小段内联脚本 `repeat` 生成（文件头注明与 `translation-only-layout.html` 无脚本的做法不同；http.server 无 CSP，可行）。
   - 每节 `<h2>` 加 `<p class="note" translate="no">`，写死本节 **Expected** 与本节计数；页首写死总数 **6**：
     - ① 普通超长段：段末灰色提示，计 1；
     - ② 短文夹 6000 字符行内 `<code>`：正常翻译，计 0；
     - ③ 单独一段的超长 URL、单独一段的超长数字串：噪声，无提示，计 0；
     - ④ 同一块里被块级子元素隔开的两段超长文字：两个提示，计 2；
     - ⑤ flex 容器的**直接子文本**为超长文字（`<div style="display:flex">超长文字</div>`，不包 `<p>`）：提示带 `data-et-inline`，计 1；
     - ⑥ 深色背景一节的超长段：提示清晰（`data-et-host="dark"`），计 1；
     - ⑦ 只看译文：复用 ①，原文保留、不加 `data-et-only`，计 0；
     - ⑧ 动态一节，初始一段超长（计 1）和两个按钮（`translate="no"`）：「改短」后提示消失并正常翻译，总数变 5；「再加一段超长」后多一个提示，总数变 6；面板计数以重新打开面板后的数值为准（「再加一段超长」不发请求，翻译状态保持完成，面板不会自动刷新，已知限制见 `skipped-count.md`）。生成的超长 URL 不含空白。

## 不做
- 只切 `hidden` 等属性的「路由」（标签页、`v-show`）：探针时临时验证（未入库）新显示的内容不翻译、隐藏的旧内容仍计入 translated。根因是监听不观察属性（`mutations.ts:1-2`），加属性监听会让所有页面付出成本，写进 m3d.md「已知限制」。
- 路由变化完全跳过冷却（预计能到约 0.4s，但会让大页面上整页重扫叠跑）。
- 包装 `pushState` / `popstate` 监听、MAIN world 桥（m3d「不做」）；独立的 SPA fixture 页。

## 已知限制
- 每次大范围变动都伴随 URL（`pathname + search` 或 hash 路由）变化的页面，整页重扫间隔固定为 1s，不再逐级拉长。
- 连续换页间隔不到 1s 时，新页面最多再等约 1s（冷却下限）。

## 测试
- **e2e**：
  - a 至 i（含上面两处修正）；
  - **j 连续切大路由不受冷却拖慢**：用 `go(path, 'text')` 原地改写 40 段，连续切 /many2、/many3、/many4（各自新路由），每次等上一路由全部译完（settle）后**立即** `go` 下一路由，记录「`go` 到该路由第一段请求到达 mock」的时间，断言第 2、3 次都不超过 1500ms，断言消息打印实测值（修前约 1950、3900，必然红；修后约 950，即冷却下限 1s 减去 settle 用时再加约 65ms 的重扫与发送，留约 550ms 余量）。去掉修复 1 时 j 仍是绿的（换路由会把等级归零，盖住多出来的那次重扫），修复 1 只靠下面的会话单测守；
  - **l 框架删掉我们的译文仍能恢复**：框架先删一个 `et-tr`、再删掉全部，两次都从会话内存补回、不重发请求（修复 1 不能挡住框架删除）。
- **单测 `mutations.test.ts`**（现有写法是真定时器加注入 `now`，保持不动）。涉及冷却时长的新用例：用已有的 `createObserver` 注入（`mutations.ts:15`、`:59-61`）手动喂 records，不依赖 happy-dom 的 MutationObserver 投递时机；时钟用 `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })`，或注入读同一假钟的 `now`，二者必须一致（只伪造定时器、`now` 仍读真时钟时冷却永远算不到期）；推进用 `advanceTimersByTimeAsync`；`afterEach` 先 stop 再 `vi.useRealTimers()`（先例 `selection/watch.test.ts:113`、`:119-124`）：
  - 整页分支、`routeKey` 变化：等级归零，冷却取 1s（先把等级升到 2，换路由后在 1s 左右触发，而不是 4s）；
  - 冷却定时器已排队时 URL 变化：URL 变化发生在距上次整页超过 1s、但短于当前冷却时，在下一个 `debounceMs` 内被处理，不等原定时器；
  - `routeKey` 不变：冷却 1s → 2s → 4s 与改前一致（冷却保护的确定性证明，替代原方案的 e2e 反例）；
  - 不传 `routeKey`：与改前一致；
  - 小范围分支不读 `routeKey`（spy 只在启动时调用一次）。
- **单测 路由键 `routeKeyOf`**：`pathname + search`；`#section` 不计入；`#/a` 与 `#!/a` 计入。
- **单测 修复 1**：`render.test.ts`：`drop` 删掉的 `et-tr` 被 `removedByUs` 认出，页面自己删的不认；`session.test.ts`：覆写 `createMutationWatch`，在真实 `watchMutations` 上额外注入 `now: () => clock`，跑一次整页重扫遗忘 40 个单元后，把 clock 拨过 2s（第一次整页后等级为 1、冷却 2s，只等几十毫秒的话没有修复 1 也看不到第二次），再等约 50ms，断言 `dirtyRounds` 里没有第二个 `[body]`。
- **变异验证**：去掉修复 1，「不出现第二次整页 onDirty」变红；去掉修复 2 的等级归零，j 与「routeKey 变化」单测变红；去掉分段等待，「定时器已排队时 URL 变化」单测变红；路由键把 hash 全算进去，路由键单测变红；比较改成永远为真，「routeKey 不变」单测变红。
- **手工验收**：按验收页逐节核对。

## 体积
修复 1、2 进 page-runtime（23.89 / 24 KB），预计增加约 0.1 至 0.15 KB，可能贴线；超出时按 m3d 决定 4 把 `scripts/check-size.mjs` 中 page-runtime 预算提到 25 KB 并注明原因与日期。content 不变。

## 文档
- 本文写实施记录；
- `m3d.md`：E 行改为已合并，分支名改为 `fix/spa-route-cooldown`，做法改为实际做法（不再写「在 onDirty 比较 location.href」）；「已知限制」补「只切 hidden 的路由不支持」与上面两条冷却限制；顶部状态写 M3d 全部完成；
- `docs/plans/skipped-count.md` 补「手工验收」一节指向验收页；
- `docs/dom-contract.md` 补一句：`et` 是历史前缀（来自旧名 Easy Translate），长期稳定，不随产品名变化（2026-11-19 用户决定保留）；
- 两份 README 的手工验收清单与 fixtures 目录说明各补一条；
- CHANGELOG「未发布」「修复」：单页应用连续切换页面时，新页面约 1 秒内开始翻译，不再因整页重扫的冷却多等 2 到 4 秒；扩展自己移除旧译文不再触发一次多余的整页重扫；
- HANDOFF：`:3` 与 `:171` 两处「下一步」改为 M3d 完成、发 v0.3.0；进度表加一行。

## 回滚
单个提交，`git revert` 即可，无数据变更。

## 分支
`fix/spa-route-cooldown`

## 实施记录（2026-11-19）
**实现**：
- `mutations.ts`：导出 `routeKeyOf`，`watchMutations` 新增可选 `routeKey`；整页分支路由变化时等级归零（冷却 1s），冷却等待按 `debounceMs` 分段。
- `render.ts`：每个 renderer 一个 WeakSet，记录 `detach` 时仍在页面上的 `et-tr`，提供 `removedByUs()`。
- `session.ts`：`ignoreRemoved` 加上 `removedByUs`，并传 `routeKey: () => routeKeyOf(win.location)`。

**测试**：`npm run check` 77 个文件 1649 个用例；新增单测 11 条（mutations 8、render 1、session 1 等）加 check 期间补强 render 1 处断言。e2e `spa-route.e2e.test.ts` 11 条（探针 a 至 i 转正并修正，新增 j、l），单文件两遍各 11/11，全量 e2e 53 通过、2 跳过（既有）。j 实测首请求（/many2、/many3、/many4）修后 359/950/925 与 376/855/938 ms，去掉等级归零后 363/1960/4022 与 369/1950/3957 ms。

**变异验证**：去修复 1、去等级归零、去分段等待、hash 全算进路由键、比较恒真、去掉 `isConnected` 判断，均有对应用例变红。

**体积**：page-runtime 23.99 / 24.00 KB（余量约 7 B，未提预算；下一个改 page-runtime 的 PR 按 m3d 决定 4 提到 25 KB），content 6.99 / 7.00 KB。

**check 结论**：第 1 轮 Opus 审无阻断，应修 1 条为文档（本次补齐）；采纳建议：补测框架先删 `et-tr` 再 drop 时不记入、两处注释补「我们 detach 的译文」、删验收页死样式、e2e 文件头加方案链接、省几个字节。第 2 轮主会话审增量无新问题。

**验收页**：`tests/fixtures/too-long-paragraph.html` 用真实浏览器的临时 e2e 核对过，总数 6，「改短」后 5，再加一段后 6。
