# 重扫保护区域修复方案（P1）：动态重扫绕过祖先排除（编辑区草稿进入翻译请求）

> 状态：已合并（#45，2026-11-18）。2026-11-18 用户批准。方案经 Opus 对抗式审查后修订（删掉发包前检查、检查前移到爬升前、补防空断言与漏掉的用例、e2e 不改 harness）。来源：Codex 评审第 1 条，核实见 `docs/reviews/2026-11-18-codex-review-verification.md`。

## 问题与根因（已核实）
- 初扫以 `body` 为根，`discoverUnits` 遍历时遇到 `isSkipped` 就拒绝整棵子树（`discover.ts:81`），所以编辑区、`translate="no"` 等子树扫不到。
- 动态重扫 `rescan()`（`session.ts:488`）的扫描根来自 MutationObserver 的被改动节点（`mutations.ts:61-69`），只向上越过行内元素（`session.ts:494`），**根自身和根的祖先都不检查**（`discover.ts:81` 的 `el !== root`）。用户在 `contenteditable` 里打字 → 根落在编辑器内 → 草稿进入翻译单元并发给服务商，译文 `<et-tr>` 还会插进编辑器内容。
- 同理可绕过：`translate="no"` / `.notranslate`、`nav` 与导航类 role、`pre`、其他翻译器节点、`data-et` 节点内的变动。
- 草稿进入单元的唯一入口是发现阶段（初扫 `session.ts:659`、重扫 `:499`）。发出去的是发现时的快照 `unit.seg.text`，重试、拆半、换引擎、32 个脏根折叠成 body（`discoverUnits(body)` 会正常跳过受保护子树）都不会带出新草稿。所以只需在重扫入口堵住。

## 参考
- FluentRead：所有入口共用「硬守卫」，扫描根查整条祖先链、子节点只查自身；局部重扫提升起点前先过守卫（`dom.ts:296-325`、`engine.ts:904-916, 975-977`）。借鉴「根查祖先链、遍历只查自身」，不引入它的站点适配器与例外体系。
- 既定决定：`m2-page-translation.md:91-99` 跳过规则与「不可见内容照常注册」；核实记录第 1 条排期「抽祖先检查，aria-hidden 保留可能临时隐藏的逻辑」。

## 方案（只改 2 个源码文件）
1. **拆分规则**（`src/content/dom-rules.ts`）：
   - `isProtected(el)`：除 `hidden` / `inert` / `aria-hidden` 外的全部现有规则（标签、自有与他家节点、`translate`、`notranslate`、`contenteditable`、`nav` 与 role）；
   - `isSkipped(el) = isProtected(el) || 临时隐藏三项`，行为与现在完全一致，初扫不变。
   - 新增 `protectedAncestor(el, stop)`：从 `el` 自身起沿 `parentElement` 向上，遇到 `stop`（`body`）停止且不检查它，返回第一个 `isProtected` 的元素，否则 `null`。
2. **重扫入口**（`session.ts` `rescan` 的循环开头）：对每个**被改动元素**先查 `protectedAncestor(element, doc.body)`，命中就 `continue`，不再爬升、不发现、不清理其中已有单元。
   - 查被改动元素而不是爬升后的根：前者的祖先链覆盖后者，更严；行内受保护元素（`<p>前文<span contenteditable>草稿</span></p>`）里的改动被跳过也不丢任何东西，因为 span 本来就被 `segment.ts:48` 整段丢掉。
   - 顺带省掉编辑器里每次按键都会触发的 `getComputedStyle` 爬升、`discoverUnits` 和全量单元清理循环。
   - 三个 `rescan` 调用者（mutation 回调 `:672`、过期单元 `:272`、被冲掉译文重插 `:537`）都经过这里。
   - 不清理已有单元是有意的：清理会调用 `renderer.drop`，在用户打字时改动编辑器 DOM，扰乱光标与撤销栈。
3. 不改 `discover.ts`、`mutations.ts`、渲染器与对外 DOM 约定。

## 取舍：临时隐藏三项不进祖先检查
弹窗打开时很多站点给整个应用根加 `aria-hidden` / `inert`，关闭只改属性；MutationObserver 不观察属性（`mutations.ts:73`），若按祖先拒绝，弹窗期间加载的内容就永远不会被翻译。现有代码与用例（`session.ts:518-521`、「keeps translations while a dialog marks the page aria-hidden」）已按此设计。这三项只影响「是否翻译页面自己的内容」，不涉及隐私与改写用户输入。

## 不做（写进方案文档的已知限制）
- 区域在**注册或翻译之后**才变成可编辑：已插入的 `<et-tr>` 留在编辑器里；已注册未翻译的单元之后仍可能把**页面原文**的译文插进去（缓存命中、在途请求、失败占位都不经发送口）。真正防住需要观察 `contenteditable` 属性或在渲染前检查，属于新能力，另议。
- `document.designMode = 'on'`、`body` 本身可编辑：初扫同样会翻译，与本修复无关。
- open Shadow DOM 内的编辑器：本来就不扫描 shadow（m2:24 留给 M3）；内容脚本只注入顶层框架。
- 用隐藏 textarea 加普通 div 渲染行的代码编辑器（如 Ace）：可见行不在任何规则内，初扫同样会翻译。
- 在 mutations 层直接丢弃编辑器内的记录（可避免大量按键挤占 32 个脏根上限）：改变 mutations 接口，另议。

## 测试
- `dom-rules` 单测：`protectedAncestor` 对编辑器内节点、可编辑容器里嵌 `contenteditable="false"`、`plaintext-only`、`translate="no"`、`.notranslate`、`nav`、`pre`、`data-et` 内返回对应祖先；`aria-hidden` / `hidden` / `inert` 祖先返回 `null`；普通段落返回 `null`；遇到 `stop` 不检查它（`body` 带 `notranslate` 时普通段落仍返回 `null`）。现有 discover 单测全过，证明 `isSkipped` 行为不变。
- `session.test.ts` 动态内容（每条都有防空断言：同一轮在编辑器外追加对照段落，`show()` 全部元素，等对照文本出现在 `sentTexts()` 后再断言草稿不在；并断言草稿元素没有被 `observe`，以及 `dirtyRounds` 确实包含编辑器）：
  - (a) 被改动元素就是受保护元素本身：`<div contenteditable>` 里直接是文字，用 characterData 改；
  - (b) 编辑器内追加 `<p>`（childList）；
  - (c) 行内 `<span contenteditable>` 嵌在 `<p>` 里打字，草稿不外发；
  - (d) 单元已发出 → 祖先设为 contenteditable → 改文字 → 回包：过期路径的重扫不发草稿；
  - (e) `translate="no"` 容器内新增段落不发送；
  - (f) `aria-hidden` 容器内新增段落仍会翻译（锁定取舍）；
  - (g) 普通区域新增段落照常翻译（对照）。
- 变异验证：去掉 `rescan` 里的检查，(a)–(e) 必须变红；改回后全绿。
- e2e 回归（提前做 e2e PR2 第 17 条，不改 harness，`google.texts` 已记录每个请求的原文）：整页翻译后，对 `#editable` 做两种改动（改文本节点、在里面追加 `<p>`），同时在正文追加一个对照段落；草稿与对照都用唯一文本避开缓存；以「对照文本出现在 `google.texts`」为同步点，再断言草稿不在其中。
- 命令：`npm run lint`、`tsc --noEmit`、`npm test`、`npm run build`、`node scripts/check-size.mjs`（逐项对比：`dom-rules` 也被 content 6.99/7KB 与 selection-runtime 引入，确认这两个包不变；page-runtime 预计 +0.2KB 以内）、`npm run test:e2e -- --retry=0` 连跑 3 次。

## 改动清单
- `src/content/dom-rules.ts`、`src/content/session.ts`
- `src/content/dom-rules.test.ts`（新建）、`src/content/session.test.ts`
- `tests/e2e/page.e2e.test.ts`（新增一条）
- 文档：本方案落到 `docs/plans/rescan-protected-areas.md`（含实施记录与已知限制）；`docs/plans/m2-page-translation.md` 5.7 节补一句「重扫先查被改动元素的祖先」；`docs/plans/e2e-smoke.md` 第 17 条标为已提前完成；核实记录第 1 条状态；CHANGELOG、HANDOFF。

## 最脆弱的假设
「草稿只能经发现阶段进入单元」。若之后有人加了「发送时重新读取元素文本」的逻辑，本修复就不再充分；方案文档里写明这条约束，单测 (d) 也会在那种改动下变红。

## 回滚
revert 本 PR；只改内容脚本逻辑，不涉及存储与数据。

## 分支
`fix/rescan-protected-areas`

## 分工
Sonnet 按方案实现与补测试；主会话验收（变异验证、体积逐项对比、e2e 连跑）后走 check 审查循环。

## 实施记录（2026-11-18）

### 实现
- `src/content/dom-rules.ts`：拆出 `isProtected`（原跳过规则去掉 hidden、inert、aria-hidden 三项临时隐藏），`isSkipped` 行为不变；新增 `protectedAncestor(el, stop)`，返回元素到 `stop` 之间（含元素自身）第一个命中 `isProtected` 的祖先。
- `src/content/session.ts` 的 `rescan`：对每个被改动元素先查 `protectedAncestor(element, doc.body)`，命中就跳过，不爬升、不发现、不清理已有单元。
- 单测：新建 `src/content/dom-rules.test.ts`（8 条）；`session.test.ts` 新增「protected areas」7 条 (a) 到 (g)，每条都带对照段落，防止空断言。
- e2e：`tests/e2e/page.e2e.test.ts` 新增「does not send edits made inside an editable area」，即 e2e PR2 第 17 条提前完成。

### 与方案的差异
- (c) 原先只放行内 span，实测去掉检查后仍然是绿的：行内 span 会被爬升到所在段落，随后被分段整段丢掉，根本不会外发。所以 (c) 同时放了一个 `display:block` 的可编辑 span，变异后才会真正外发译文请求。

### 变异验证
- 去掉 `rescan` 里的检查：(a) 到 (e) 与新 e2e 变红，(f)(g) 仍绿。(f)(g) 守的是「临时隐藏三项不属于保护」与初扫行为，不依赖这条检查，符合预期。

### 体积
- content 6.99 KB 不变，selection-runtime 18.17 KB 不变，page-runtime 22.08 KB 到 22.13 KB。

### 验证
- lint、tsc、`npm test`（76 个文件、1504 个用例）、build 均通过。
- e2e（macOS 本地）：17 通过、1 预期失败、2 跳过；`--retry=0` 连跑 3 次全绿。CI（Linux）预期 19 通过、1 预期失败。
- check 审查第 1 轮：无阻断问题。
