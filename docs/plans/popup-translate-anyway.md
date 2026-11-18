# 面板「仍然翻译」方案（Codex 第 7 条）

> 状态：已合并（#49，2026-11-18）。2026-11-18 用户批准，新增文案已确认。方案经 Opus 对抗式审查后修订。来源：`docs/reviews/2026-11-18-codex-review-verification.md` 第 7 条（P3）。

## 问题
面板只按 `<html lang>` 判断页面语言（`content.ts:42-45`）。`lang` 等于目标语言时进入 `native` 状态（`panel-state.ts:23`），面板只显示「这一页已经是 X / 不需要翻译。」，同时隐藏「翻译此页」（`App.tsx:176`）、目标语言选择（`:131`）和「总是翻译此站」（`:111`）。中文站点里嵌一篇英文文章时，用户在面板里无法开始翻译，只能靠快捷键或页面右键菜单（灵岛要在翻译开始后才出现，不是入口；核实记录「灵岛仍可用」的说法据此更正）。

拦截只在面板界面：`page.start` / `page.toggle` 与会话都不看页面语言（`bootstrap.ts:141-156`、`session.ts:741`）；后台逐段判断同语言，只跳过可靠识别为目标语言且占比 ≥ 80% 的段落（`service.ts:275-290`、`languages.ts:70-95`），所以混合语言页面强制翻译会正常出译文。

## 方案（只改面板，约 10 行）
1. `native` 状态在原有提示下方**复用 `IdleActions`**，加一个变体参数：按钮用已有的 `.secondary` 样式（与主按钮同尺寸、描边）、文案用「仍然翻译」。开始路径、开始后关闭面板、引擎未就绪时换成「用 Google 翻译一次」全部沿用 `IdleActions`（`App.tsx:302-325`），不在 `native` 分支重写一遍。该变体不显示「未设快捷键」的提示行（`:332-343`），保持安静。
2. 按钮放在 `.message` 外、用 `.stage` 包起来：`.message span` 会把字号改成说明文字、颜色改灰（`popup.module.css:284-287`），放进去按钮文字会被染色。
3. `native` 状态也显示头部的目标语言选择；左侧语言标签改为 `view.kind !== 'loading' && view.language` 时显示语言名（现在只在 `foreign` 显示，`native` 会出现「自动检测 → 简体中文」，与「检测到 简体中文」矛盾）。用户改了目标语言，`panelState` 每次渲染重算（`:86-87`），自然回到 `foreign` 并显示主按钮。
4. 「总是翻译此站」在 `native` 页面始终不显示：`canAlways` 改为 `view.kind !== 'native' && (active || foreign)`（现为 `:111`，否则用「仍然翻译」开始后再开面板，开关会出现但无效）。理由：对声明为目标语言的站点设「总是翻译」大概率是误操作，且自动开始本身因 `lang` 等于目标而不触发（`auto-start.ts:46-47`）。
5. 不改：页面语言判断（仍只读 `lang`，不做正文检测）、内容脚本、会话、后台同语言跳过（不传 `force`，避免把中文段落再「翻译」成中文浪费请求）。

考虑过的更小做法：把 `native` 的提示改成可点击文字链接（会丢掉引擎未就绪时的 Google 兜底）、或在 `native` 直接显示主按钮（视觉上与需要翻译的页面无区别，削弱「不需要翻译」的提示），都不采用。

## 新增文案（需用户确认）
| key | en | zh_CN | zh_TW |
|---|---|---|---|
| `popup.translateAnyway` | Translate anyway | 仍然翻译 | 仍然翻譯 |

`nativeHint`（「不需要翻译。」）保持不变。

## 已知限制
整页确实全是目标语言时，点「仍然翻译」后所有段落都会被后台判为同语言跳过，页面不出现译文，灵岛显示翻译完成。这与现在用快捷键在同样页面开始的表现相同，不是新问题；要给反馈需要会话统计同语言段数，不在本次范围。

## 测试
- `panel-state.test.ts` 不变（状态判定没改）。
- e2e（`ui.e2e.test.ts`，沿用 PR2 的「面板真实链路」写法：导航前注入，把 `tabs.query` 换成返回测试页）：新增 fixture `tests/fixtures/e2e-native.html`（`<html lang="zh-CN">`，正文为英文段落，目标语言设为简体中文）。断言面板显示「这一页已经是…」、出现「仍然翻译」按钮与目标语言选择（左侧显示页面语言名）、不出现「总是翻译此站」；点「仍然翻译」后测试页英文段落出现【MOCK】译文；翻译开始后再打开面板，仍不出现「总是翻译此站」。用 `start('en')` 时按英文文案断言。
- 变异验证：去掉 `native` 状态里的按钮（或让它不触发开始）→ 用例变红；`canAlways` 改回原条件 → 「再打开面板不出现开关」变红。
- 命令：`npm run lint`、`tsc --noEmit`、`npm test`、`npm run build`、`node scripts/check-size.mjs`（popup 83.09 / 90 KB）、`npm run test:e2e -- --retry=0` 连跑 3 次。
- 手工：在一个 `lang="zh-CN"` 的中文站打开含英文的页面，看面板布局（280px 宽）与按钮样式。

## 文档
本方案（落地后补实施记录）；核实记录第 7 条状态并更正「灵岛仍可用」；`docs/plans/m2-page-translation.md:97`「入口提示这一页已经是…」后补一句「面板保留『仍然翻译』」；CHANGELOG；HANDOFF。

## 回滚
revert 本 PR；只改面板界面与文案，不涉及存储与数据。

## 分支
`fix/popup-translate-anyway`

## 实施记录（2026-11-18）
- 实现：面板在 `native` 状态于原有提示下方复用 `IdleActions` 的 anyway 变体，显示次级按钮「仍然翻译 / Translate anyway / 仍然翻譯」（secondary 样式，不显示未设快捷键提示，引擎未就绪时同样换成用 Google 翻译一次）；`native` 也显示目标语言选择，左侧显示页面语言名；「总是翻译此站」在 `native` 页面始终不显示（含会话进行中）。未改页面语言判断、内容脚本、会话与后台同语言跳过。
- 已知限制：整页全是目标语言时点「仍然翻译」不会出译文（后台逐段跳过，与快捷键行为一致）。
- 测试：新增 fixture `tests/fixtures/e2e-native.html` 与 `ui.e2e.test.ts` 用例「offers "Translate anyway" on a page that declares the target language」。
- 变异验证：去掉 `native` 按钮、把 `canAlways` 改回原条件，两组均变红。
- 体积：popup 83.09 KB 增至 83.15 KB。
- 验证：lint、tsc、`check:i18n`、`npm test`（1536 个用例）、build 通过；e2e `--retry=0` 连跑 34 通过、2 跳过（CI Linux 预期 36 通过）。
- check：第 1 轮无阻断问题。建议项：引擎未就绪时 `native` 页面的 Google 兜底仍为主按钮样式，与普通页面一致，不改。
