# 仅看译文样式精确恢复（Codex 第 2 条）

> 状态：已合并（#46，2026-11-18）。2026-11-18 用户批准。方案经 Opus 对抗式审查后修订。来源：Codex 评审第 2 条（P2），核实见 `docs/reviews/2026-11-18-codex-review-verification.md`；顺带修掉 e2e 记录的已知问题「显示原文后残留空 `style=""`」。

## 问题
1. **整串覆盖抹掉网页的改动。** 进入「仅看译文」时，`applyOnly`（`render.ts:264-285`）记下块根元素整串 `style` 属性，再用 `style.setProperty` 钉住 min/max 宽高、flex-basis、text-indent、margin、padding、width、height（`render.ts:221-243`，防止根元素 `font-size:0` 后 em/ch 长度归零）。退出时 `removeOnly`（`render.ts:286-297`）把整串写回，网页在这期间对该元素内联样式的任何改动（例如颜色由红改蓝）都被抹掉。
2. **空 `style=""` 残留（真实 Chrome 才有）。** 已在 Chrome for Testing 158 用纯 DOM 复现，与扩展和动画无关：`setProperty` 只把 style 属性标为待同步、不立即写属性；随后 `removeAttribute('style')` 删了属性却没清掉标记，之后任何序列化或读属性都会按空声明补写 `style=""`。`setProperty` 之后、`removeAttribute` 之前至少读一次 `getAttribute('style')` 就能避免。挂了 `attributeFilter:['style']` 的 MutationObserver 也会强制同步，所以被观察的元素不出现；happy-dom 没有这套惰性同步，单测抓不到。
- 切回双语（`setMode`）、显示原文（`restoreAll` 经 `detach`）、单元被移除（`drop`，含 retry、forget、fail、insert 重插）都只经过 `removeOnly`，一处修复覆盖全部（已逐一核对调用点）。

## 参考
- FluentRead 对布局覆盖做精确还原（`src/features/full-page-translation/content/state.ts:160-168, 1619-1648`）：整串仍等于写入后的整串就整串还原，否则逐属性比对。审查实测发现逐属性记「原值」在含 `var()` 的简写上读不到长写值（Chrome 返回 `''`），会把原样式整组删掉，所以我们改用「差异重放」：不记原值，只比对「钉完后」与「现在」的差异。
- 既定决定：`m2-page-translation.md:138`「钉住前记下原 style 属性，还原时恢复原值，原来没有就删除」；内联样式不在对外约定内（`docs/dom-contract.md:29`），可改实现。

## 方案（只改 `src/content/render.ts`）
1. **记录**：`Rendered.only` 由 `{ styleAttr }` 改为 `{ original, applied }`：
   - `original`：进入前的整串（`null` 表示没有 style 属性）；
   - `applied`：钉完后立即 `getAttribute('style')` 读回的整串。这次读取也让属性同步，不再留下待同步标记。
2. **还原**（`removeOnly`），先读 `current = root.getAttribute('style')`：
   - `current === applied`（网页没碰过）：整串还原，`original === null` 则 `removeAttribute('style')`，否则 `setAttribute('style', original)`。逐字节还原，含 `var()` 简写与网页原本的书写格式。
   - `current === null`（网页自己删掉了 style 属性）：保持没有属性，不写回原样式。
   - 否则（网页改过）：用一个不挂到页面的临时元素解析 `applied`，与 `root.style` 逐个长写属性比较值和优先级，得出网页改了、加了、删了哪些属性；然后整串写回 `original`（`null` 则删属性），再把这些差异用 `setProperty(name, value, priority)` / `removeProperty(name)` 重放上去；最后若 `original === null` 且 `root.style.length === 0`，读一次属性后 `removeAttribute('style')`。
   - 其余不变：删 `data-et-only`、清 `et-tr` 上的 `--et-*`、`record.only = undefined`。
3. 不改 `styles.ts`、`session.ts`、对外 DOM 约定。

## 不做（写进本文的已知限制）
- 仅看译文期间网页改了**被钉住**的属性（如 width）：退出时保留网页的值；但仅看译文期间网页的新值会盖过钉值，该段布局可能走样，切回后正常。要实时跟随需要观察 style 变化，另议。
- 网页改动后的值恰好等于我们钉的值：视为没改，会被还原成原值（概率极低）。
- 钉住时不保留原内联值的 `!important`（`width: 50% !important` 钉成 `width: …px`），仅看译文期间若样式表对同一属性也有 `!important`，层叠结果会变。这是既有行为，退出后恢复正常。
- vw/vh、媒体查询尺寸被钉成切换当时像素（`m2-page-translation.md:144`）不变。
- 范围外，另记：`setMode` 没有串行化，60ms 淡出期间先切仅看译文再立即切回双语，第二次调用因 `next === mode` 提前返回（`render.ts:445`），最终停在仅看译文。

## 测试
- `render.test.ts`（happy-dom；margin/padding/width 依赖 `computedStyleMap`，沿用现有桩写法 `render.test.ts:123-139, 166-181`，否则这些属性不会被钉住，用例会测空）：
  - 网页未改：原有内联 `color: red;` 逐字节还原；原本无 style → 无 style 属性（现有用例保留）；
  - 网页改了未钉住的属性（color 红改蓝）：切回双语、显示原文两条路径后整串均为原样式加 `color: blue`，钉住属性全部移除；
  - 原本无 style、网页加 color → 只剩 `color: blue;`；
  - 网页改了某个钉住属性（margin-left，靠桩钉住）→ 保留网页值，其余钉住属性移除；
  - 网页删掉一个钉住属性 → 该属性不再出现，其余钉住属性移除，原本无 style 时走删属性分支；
  - 网页 `removeAttribute('style')` → 退出后仍无 style 属性；
  - 原有 `width: 50% !important` + 网页改 color → `width` 按原值与 `important` 回来。
  - 变异验证：把还原改回整串覆盖，「网页改过」各用例必须变红。
- e2e（真实 Chrome，覆盖 happy-dom 抓不到的惰性同步与 `var()` 简写）：
  - `modes.e2e.test.ts`：`it.fails('leaves no empty style attribute after translation-only')` 改为普通 `it`，同时拆掉为 `it.fails` 写的 `roundTrip().catch(...)` / `if (!reached) return` 包装，并去掉 :135 与第一个用例中的 `.replaceAll(' style=""', '')` 容错；
  - 新增（提前做 e2e PR2 第 18 条）：进入仅看译文后，页面主世界把 `#intro` 的 color 设为蓝 → 显示原文 → `#intro` 的 style 整串等于 `color: blue;`；另一个块在仅看译文期间 `removeProperty('text-indent')` → 显示原文后没有 style 属性；
  - fixture `tests/fixtures/e2e-article.html` 增加一个带 `style="margin: 0 var(--x); --x: 10px"` 的块：网页改其 color → 显示原文后 margin 与 `--x` 仍在、color 为新值。
  - 内容脚本的 MutationObserver 只观察 childList / characterData（`mutations.ts:73`），主世界改属性不会触发重扫，不影响断言。
  - 变异验证：去掉 `applied` 那次读取，同时让还原在 `removeAttribute` 前不读属性（临时跳过比较），空 style 用例必须变红；单删其中一处不会变红（另一处仍会同步），实施记录里写明。
- 命令：`npm run lint`、`tsc --noEmit`、`npm test`、`npm run build`、`node scripts/check-size.mjs`（page-runtime 22.13 / 24 KB）、`npm run test:e2e -- --retry=0` 连跑 3 次。
- 手工：`tests/fixtures/translation-only-layout.html` 各用例切换前后布局不变（沿用既有验收）。

## 一并处理的文档
- 本方案文档（落地后补实施记录）。
- `docs/plans/m2-page-translation.md:138` 改为「整串还原后重放网页在此期间的改动」。
- `docs/plans/e2e-smoke.md`：第 18 条（:57）标为已提前完成；已知问题（:108）标为已修复。
- `docs/reviews/2026-11-18-codex-review-verification.md`：第 2 条状态。
- `CHANGELOG.md:10` 改写「已知问题：…残留空的 `style` 属性」那句，并在「修复」加一条面向用户的说明；`HANDOFF.md:253` 同一已知问题与阶段摘要。
- 单独一个提交（与修复无关、按约定随本分支记录）：新建 `docs/reviews/2026-11-18-ux-triage.md` 记录上一轮三个体验点的评估结论，HANDOFF 排期加入「段落加载态」（本条之后），并记下 `setMode` 未串行化这条待办。

## 最脆弱的假设
「`setProperty` 之后读一次 `getAttribute('style')` 就能强制同步」依赖 Chrome 当前实现（已在 Chrome for Testing 158 验证）。若将来行为变化，e2e 的空 style 用例会变红报警。差异重放本身不依赖这一点。

## 回滚
revert 本 PR；只改内容脚本渲染逻辑，不涉及存储与数据。

## 分支
`fix/translation-only-style-restore`

## 分工
Sonnet 按方案实现与补测试；主会话验收（变异验证、e2e 连跑、体积）后走 check 审查循环。

## 实施记录（2026-11-18）
- **实现要点**（`render.ts`）：`Rendered.only` 改为 `{ original, applied }`。`applyOnly` 钉完后立即读回 style 属性存为 `applied`，同时强制同步。新增 `restoreStyle`：现值等于 `applied` 就整串还原（原本没有 style 则删属性）；网页删掉了 style 属性则保持无属性；其余情况先写回原样式，再重放网页在仅看译文期间的改动（逐个长写属性比较值与优先级）；最后原本无 style 且已空，读一次后删属性。
- **测试**：`render.test.ts` 新增 6 条（page edits while translation-only is on）。e2e `modes.e2e.test.ts` 把 `it.fails` 改为普通 `it`（拆掉吞错包装与 `replaceAll` 容错），新增「keeps what the page changed in a block while translation-only was on」（e2e PR2 第 18 条提前完成）与「keeps a var() shorthand margin working after translation-only」；fixture `e2e-article.html` 新增 `#pinned`（`style="margin: 0 var(--x); --x: 10px"`）。
- **变异验证**：
  1. 改回整串覆盖：「网页改过」单测 5 条与两条新 e2e 变红。
  2. 两处读取都去掉：空 style 的 e2e 变红。
  3. 只去掉还原开头那次读取：空 style 用例仍绿，钉完后那次读取已足够同步。
- **体积**：`check-size` page-runtime 22.13 到 22.31 KB（预算 24），content 6.99、selection-runtime 18.17 不变。
- **验证**：lint、tsc、`npm test`（76 文件 1510 用例）、build 通过；e2e `--retry=0` 连跑 3 次全绿，20 通过、2 跳过（macOS；CI Linux 预期 22 通过）。
- **check 结论**：第 1 轮无阻断问题。
