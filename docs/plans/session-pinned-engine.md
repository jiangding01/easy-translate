# M3d PR-B1：会话固定引擎与 setMode 串行化

> 状态：已合并（#54，2026-11-19）。方案经 Opus 对抗式审查后修订，用户批准。总方案见 `docs/plans/m3d.md`（用户决定第 6、7 条）。

## 问题
1. **会话没有固定引擎**（Codex 第 3 条）：`session.ts:774` `engine = options.engine`，默认引擎时为 `undefined`，请求不带引擎（`:463-469`），后台每批读当前默认（`service.ts:266`）。在设置页或面板改默认引擎，已打开页面的后续段落会换引擎；灵岛（`isle.ts:924-926`）与面板（`App.tsx:399`）显示的也是实时默认。`session.ts:814-816` 注释写「语言与引擎在会话内固定」，与实现不符。
2. **setMode 未串行化**：`render.ts:568` 以 `next === mode` 早返回，`mode = next` 在 60ms 淡出 `await` 之后（`:597`）。淡出期间切回原模式（b→t→b）会被吞掉，最终停在 translation；淡出期间重复请求同一模式（t、t）会对同一记录读两次样式，把已钉的样式当成原值。会话侧 `session.ts:858-863` 也不排队。

## 方案（只改 page-runtime 与面板一处标签显示）
1. **固定引擎**（`session.ts`）：保留 `:774` 的 `engine = options.engine`，在读完配置并通过 `:777` 的 epoch 检查后补 `engine ??= config.translation.engine`。这样读配置期间用户点的「这次先用」不会被覆盖。会话内只有「这次先用」能改引擎；`stop` 时清空（`:847`），下次开始按当时的默认重新固定。`state().engine` 在会话读到配置后恒有值，请求恒显式带引擎。
2. **暂停时选同一引擎仍能解除暂停**：`:753` 的切换条件改为 `options.engine !== undefined && phase !== 'idle' && (options.engine !== engine || engineError !== undefined)`。原来默认引擎时 `engine` 为 `undefined`，同引擎也会走切换分支并清错；固定后显式保留这条防御路径（UI 里几乎走不到：灵岛过滤同 id，面板对 Google 暂停给「重试」）。不同引擎的切换语义不变：已译保留，未译与失败段改用新引擎。
3. **engineFailed 不变**：`used === engine` 才暂停，固定后比较更准确。
4. **删除正在使用的自定义引擎**（行为变化，写入 CHANGELOG）：删除当前默认的自定义引擎时，默认重置为 Google（`repository.ts:204-211`）。原来已打开的页面会无缝跟到 Google；现在该页固定的是被删除的引擎，后台取设置抛 `config/provider-missing`（`registry.ts:43`，引擎级），会话暂停，灵岛显示错误，可在灵岛列表或面板「用 Google 一次」继续。灵岛 aria-label 在引擎已不在列表时名称为空，按面板的同款回退显示引擎 id（`isle.ts:954-959`，参照 `App.tsx:293`），不加文案。
5. **灵岛显示**：`currentEngine()` 保持 `last.engine ?? configEngine ?? options.configured`，不改代码。固定后 `last.engine` 在读到配置后恒有值；读配置前的兜底值就是即将固定的默认，不会在会话中途闪回。
6. **面板**：`App.tsx:399` 的兜底保留，行为随会话固定自然正确（原来「默认 DeepSeek、会话实际 Google 暂停」时误显示「用 Google 一次」，现在修正）。页脚引擎选择器是默认引擎设置，只写默认配置、不影响当前页（决定第 6 条）；它的标签 `popup.defaultEngine`（「默认引擎」）目前只给读屏，改为可见，避免会话中改默认后用户误以为当前页换了引擎。不新增文案；实施时用截图确认 280px 面板页脚布局。
7. **setMode 串行化**（`render.ts`）：用 `switching`（进行中的 Promise）加 `wanted`（最后一次请求的目标）两个变量：
   - 没有切换在进行且 `next === mode` 时才早返回；切换进行中收到任何请求（包括等于当前 `mode` 的）都只更新 `wanted` 并返回同一个 Promise；
   - 淡出结束后读 `wanted` 一次并直接应用；`wanted === mode`（切过去又切回）时只淡入、不改样式，不先应用中间目标，避免把中间 mode 推给灵岛与面板；
   - `restoreAll` 置 `disposed` 后沿用现有取消逻辑；淡出期间新插入的段落在重读 `switchable` 时一并切换。
   会话侧 `setMode` 不另加队列，`notify()` 在渲染器 Promise 结束后发出。
8. **注释**：`protocol.ts:55-56`、`:76`、`:149-150` 与 `service.ts:270` 中「一次性引擎 / 只对这一次请求生效」的说法，改为「本会话实际使用的引擎（开始时固定，『这次先用』可改）」或与之一致。

## 不做
- 不加「默认已变，下次生效」提示（决定第 6 条）。
- 不把面板页脚改为「切换当前页引擎」。固定 Google 且暂停时，面板只给「重试」；要换引擎从灵岛列表切。这是按决定第 6 条接受的取舍。

## 测试
- `session.test.ts`：
  - 新增：会话开始后改默认引擎（经 `watchConfig` 推新配置），后续请求仍带原引擎，`state().engine` 为原引擎；
  - 新增：读配置期间（`getConfig` 挂起）`start({ engine: 'deepseek' })`，放行后请求带 `deepseek`（第 1 条的竞态）；
  - 新增：idle 时 `start({ engine })` 后 `state().engine` 为该引擎；stop 后改默认再 start，用新默认；
  - 新增：固定引擎被删除（后台返回 `config/provider-missing`）时进入暂停；
  - 调整：`:401` 断言 `payload.engine` 由 `undefined` 改为 `'google'`；`:402` 起的辅助流程与 `:409`、`:423`、`:443` 改用非默认引擎表达「切换」；`:1460` 改为断言开始时即推送固定引擎、切换后推送新引擎；
  - 保留不改：`:649-698`、`:905`、`:1022` 中暂停时 `start({engine:'google'})` 的用例，它们正好覆盖第 2 条「暂停时同引擎解除」。
- `render.test.ts`（关键：happy-dom 下 `getBoundingClientRect` 全为 0、没有 `animate`，现有用例走不到淡出等待，会空过）：给根元素桩 `getBoundingClientRect`，桩 `Element.prototype.animate` 返回可手动放行的 `finished` 与 `cancel`；用例：
  - 淡出期间 b→t→b，最终停在 bilingual（原 bug）；
  - 淡出期间请求 t、t，再切回 b，`body.innerHTML` 与切换前完全一致（不重复读样式）；
  - `:646`「淡出中 restoreAll」用同一套桩重写，确保真正走到淡出期间。
- `isle.test.ts`：灵岛代码不改，不加用例（旧代码也会通过，无保护作用）；只为第 4 条的名称回退补一条。
- 变异验证：`engine ??=` 去掉 → 固定引擎用例变红；固定位置挪回 `:776` 之后的直接赋值 → 竞态用例变红；去掉 `engineError` 条件 → 同引擎解除暂停用例变红；恢复 `next === mode` 早返回 → b→t→b 用例变红；去掉 `wanted` 只淡入分支 → t、t、b 用例变红。
- e2e（`session.e2e.test.ts`）：会话翻译完成后，经 options 页 `config.patch` 把默认引擎改为 DeepSeek（不设密钥），等返回成功后插入唯一文本的新段落；断言新段落翻译成功、`h.google.texts` 含该文本、无 `engineError`。若会话错用新默认，会因缺密钥暂停或请求被拦截报错，能真实区分。
- 命令：`npm run check`、`npm run test:e2e -- --retry=0`。体积：page-runtime 23.16 / 24 KB，贴实测；popup 截图确认页脚。

## 文档
本方案（实施记录）；`docs/plans/m3d.md` 的 B1 行改为「面板与灵岛显示会话实际引擎（读配置前沿用默认作兜底）」并补 PR 号；`docs/reviews/2026-11-18-codex-review-verification.md` 第 3 条状态；CHANGELOG（修复：改默认引擎不再影响已打开页面，灵岛与面板显示当前页实际使用的引擎；快速连切双语与仅看译文停在最后一次；变化：删除正在使用的自定义引擎后，已打开页面会暂停并提示，而不是自动换成 Google；面板页脚显示「默认引擎」标签）；HANDOFF。均写成合并后的终态。

## 回滚
revert 本 PR；只改内容脚本会话与渲染逻辑、面板一处标签显示，不涉及存储与数据。

## 分支
`fix/session-pinned-engine`

## 实施记录（2026-11-19）
**实现**（均按方案）：
- `session.ts`：保留 `engine = options.engine`，读完配置并通过 epoch 检查后 `engine ??= config.translation.engine`，读配置期间的「这次先用」不被覆盖；切换条件加 `|| engineError !== undefined`，暂停时选同一引擎仍可解除。
- `render.ts`：`setMode` 用 `switching` 加 `wanted` 串行化，淡出后读一次 `wanted` 直接应用，切过去又切回只淡入、不改样式；`restoreAll` 沿用取消逻辑。
- 灵岛：引擎不在列表时名称回退为引擎 id。
- 面板页脚：「默认引擎」标签（`popup.defaultEngine`，原只给读屏）改为可见。
- 注释：`protocol.ts` 三处、`service.ts` 一处改为「本会话实际使用的引擎（开始时固定，『这次先用』可改）」。

**与方案的差异**：
- 页脚标签叠放在引擎名上方，用小字，字号 `calc(var(--et-fs-caption) - 2px)`；check 建议以后收进字号令牌。
- `render.test` 比方案多 2 条：「切回时不重读样式」（去掉 `next !== mode` 判断的变异最初不红，补这条后变红）、「淡出期间插入的段落一起切换」；并给 `getBoundingClientRect` 与 `animate` 打桩，使淡出期间的情形能真实走到。
- 删除正在使用的自定义引擎的用例用模拟的引擎错误测试，没有走真实的删除流程。

**测试**：`session.test` 新增 4 条，调整 `:401` 与切换流程用例改用 deepseek，推送用例改名；`render.test` 新增 4 条（b→t→b 停在 bilingual、t,t,b 页面完全复原、切回时不重读样式、淡出期间插入的段落一起切换），重写「淡出中 restoreAll」；`isle.test` 新增 1 条；e2e `session.e2e` 新增「默认引擎改为 DeepSeek 后新段落仍走 Google」。

**变异验证**：5 组均变红。

**体积**：page-runtime 23.16 到 23.23 KB（上限 24），popup 83.15 到 83.17 KB。

**验证**：`npm run check` 退出码 0（1561 个用例）；e2e 全套与新用例连跑全绿。

**check 结论**：第 1 轮无阻断问题。
