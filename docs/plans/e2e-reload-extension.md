# 扩展重载后旧页面不报错（冒烟 e2e 第 15 条）

> 状态：已合并（#51，2026-11-18）。2026-11-18 用户批准（选择一并做「失联即 halt」）。方案经 Opus 对抗式审查后修订。来源：`docs/plans/e2e-smoke.md` PR2 第 15 条（PR2 时推迟，见 `docs/plans/e2e-smoke-pr2.md`）。

## 实测（方案前，在 scratchpad 完成，仓库无改动）
- **harness 可行**：在已开开发者模式的前提下，SW 里执行 `chrome.runtime.reload()` 后约 15ms 旧 SW 的 session 报 `targetCrashed` 并 detach，约 100ms 新 SW 以新 targetId 自动挂上、停在等待调试器，现有 `onAttached` → `armWorker` 自动重开拦截，扩展 id 不变。同一浏览器连续重载 10 次 10/10 稳定，sessions 不泄漏。
- **前提**：不开开发者模式时，重载后扩展会被禁用（`DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION`）。预写 Preferences、`--disable-features` 都无效；有效做法是打开 `chrome://extensions` 执行 `chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })`（约 75ms，页面被 harness 自动挂上但不产生未拦截请求）。`developerPrivate` 是私有 API，只在本机 macOS 验证过，合并前必须在 CI（ubuntu）跑通。
- **产品 bug（10/10 复现）**：扩展失联后，`browser.i18n.getMessage` 会同步抛错。内容脚本取文案的 `lookup()`（`src/content/i18n.ts:70-74`）没有接住，成为页面上未处理的「Extension context invalidated.」：
  1. 灵岛渲染（`isle.ts:950-951` 的 `message('common.retry')`、`pluralMessage('isle.retryCount')`）：翻译进行中重载、翻译后页面变动、**重载后点灵岛按钮**都会出现。最后一种不经过会话 halt：静态页重载后不再发请求，会话永远不 halt，灵岛一直留着，每点一次就多一条错误。
  2. 加载点在失联后、halt 前写入时取 `uiLocale()`（`i18n.ts:85-87`）。
  3. 划词卡片打开时重载、再点复制（`card.ts:1623` 的 `message('card.copied')`）。
- **同类排查（已在旧隔离世界逐个实测）**：失联后同步抛错的扩展 API 有 `runtime.getURL`、`i18n.getMessage`、`i18n.getUILanguage`、`i18n.detectLanguage`、`storage.local.get`、`runtime.sendMessage`、`runtime.connect`。除 `getMessage` 外，内容脚本里的调用点都在 async 函数或 try 内，失联后不会成为未处理错误（`content.ts:50/68/75/96/100`、`loader.ts:20`、`config/client.ts:112`、`port.ts` 的 `post`、`languages.ts:55` 等）。唯一漏网的是 `getMessage`。
- **体积**：`i18n.ts` 不在常驻 content 入口（`content.js` 里没有 `getMessage`），只在 page-runtime 与 selection-runtime，各有约 0.8–0.9 KB 余量。

## 方案
### 1. 产品修复（`src/content/i18n.ts`）
- 在 `lookup()` 里捕获 `getMessage` 抛出的异常并返回空串。这样 `message`、`pluralMessage`、`errorText` 都覆盖到（仓库已有同类写法：`languages.ts:55` 对 `getUILanguage` 的 try/catch）。空串优于返回 key：可见文本处 key 更难看；`uiLocale()` 已有 `|| 'en'` 回落，加载点随后被 halt 移除，错几毫秒的 `lang` 无影响。不加任何缓存。

### 2. harness（约 +30 行）
- `reloadExtension()`：首次调用时 `Target.createTarget('chrome://extensions')`，按 targetId 在 sessions 中找到自动挂上的 session（参照 `waitForExtPage`），`waitFor(!!chrome.developerPrivate)` 后执行 `updateProfileConfiguration({ inDeveloperMode: true })` 并关闭该页；记下旧 `swSession`，在 SW 里 `setTimeout(() => chrome.runtime.reload(), 20)`；`waitFor` 旧 session 已移除，再 `waitFor(swReady && swSession !== old)`，最后 `sw('!!chrome.tabs')` 确认新 SW 可用。
- 约定（写进注释）：重载前关闭持有的扩展页（会被替换成新标签页）；重载后不对旧页面用 `tell`（会一直轮询「Receiving end does not exist」直到超时），只看 DOM。

### 3. 用例（新文件 `tests/e2e/reload.e2e.test.ts`，自己 launch；每条开头清缓存）
- **A 翻译进行中重载**：挂起 Google 回包，先断言确实在翻译（在途请求 > 0、出现加载点、灵岛在）；重载后放行；`waitFor` 加载点清零且灵岛消失（证明内容脚本察觉失联并 halt）；原文完整、无残留 `et-tr`；`assertNoErrors()`。
- **B 翻译完成后页面变动**：记下译文数 N，重载，插入新段落并滚动；`waitFor` 灵岛消失；译文数仍为 N、新段落无译文、Google 请求数不变；`assertNoErrors()`。
- **C 重载后点灵岛按钮**：翻译完成后重载，不触发任何请求，确认灵岛仍在（失联尚未被察觉），点灵岛的模式按钮；断言灵岛消失、已有译文保留；`assertNoErrors()`。修复前这条路径不经过 halt、每点一次多一条错误，与 B 互补。
- **收尾**：同一标签页重新打开测试页，插入一段全新文本，断言 Google 请求数增加且渲染出译文（缓存命中证明不了新 SW 的拦截在工作）。
- **先红后绿留证**：先只加 harness 与用例，本地跑一次确认 A、B、C 全红并把失败日志摘要写进实施记录，再加修复转绿；变异验证「去掉 `lookup` 的捕获 → A、B、C 全红」。

### 4. 失联即 halt（用户 2026-11-18 选择一并做）
修复报错后，静态页重载后灵岛仍会一直留着：标签为空、引擎列表取不到、重试无效。在按需加载的 page-runtime（`src/entrypoints/page-runtime.ts`）里，会话通知或灵岛操作时调用 `browser.i18n.getUILanguage()`（失联后同步抛错或 `browser.i18n` 为 undefined，落入 catch 即失联），发现失联就 halt，灵岛随之卸载（只能放在 page-runtime，常驻 content 只剩 0.01 KB）。用户可见变化：失联后点灵岛，灵岛直接消失，页面上已有的译文保留。C 用例的断言为「点击后灵岛消失、已有译文保留、无错误」。

## 不做
- 失联后给旧页面任何提示（例如「扩展已更新，请刷新页面」）：需要新增文案与界面，另议。
- 用 `chrome.management.setEnabled` 或 CDP `Extensions` 域代替重载：前者语义是禁用再启用、不触发 `onInstalled(update)`，后者不接受命令行加载的扩展；真实用户场景是更新重载。

## 测试
- 单测（`src/content/i18n` 的测试文件，没有就新建）：`getMessage` 抛错时 `message()` 与 `pluralMessage()` 返回空串不抛出，`uiLocale()` 回落 `'en'`。
- e2e：A、B、C 修复前全红、修复后全绿；新文件 `--retry=0` 连跑 5 次全绿；全套 `--retry=0` 连跑 2 次；合并前 CI 上跑通（验证 `developerPrivate` 在 ubuntu 可用）。
- 命令：`npm run lint`、`tsc --noEmit`、`npm test`、`npm run build`、`node scripts/check-size.mjs`。
- 手工：真机 Chrome 打开一页翻译中，到 `chrome://extensions` 点重载，确认页面控制台无未处理错误。

## 文档
本方案（落地后补实施记录，含同类排查结果与先红后绿日志）；`docs/plans/e2e-smoke.md`（第 15 条完成）；CHANGELOG（修复：扩展更新或重载后，已打开页面上的灵岛与划词卡片不再报错）；HANDOFF。

## 回滚
revert 本 PR；只改内容脚本取文案的容错、page-runtime 的失联检查与测试，不涉及存储与数据。

## 分支
`feat/e2e-reload-extension`

## 实施记录（2026-11-18）
- **产品修复**：`src/content/i18n.ts` 的 `lookup()` 把取 `browser.i18n.getMessage` 与调用都放进 try，失联时返回空串（失联时 `browser.i18n` 可能整个是 `undefined`）。灵岛、加载点、划词卡片取文案都经它，三处未处理的「Extension context invalidated」一并修复。
- **失联即 halt**（用户选择一并做）：`session.ts` 的 `SessionDeps` 新增可选 `alive()`，`notify()` 开头若失联则 halt，灵岛随之卸载，已有译文保留；`page-runtime.ts` 传入 `alive`（try 调用 `browser.i18n.getUILanguage()`，抛错即返回 false；不读 `runtime.id`，因按需模块禁止读扩展 ID）。常驻 content 不变。
- **踩坑**：最初用 `runtime.id` 判断，被 `check:build` 的防探测规则拦下（CI 失败），改为调用 `i18n.getUILanguage` 判断；本地漏跑 `check:build`，之后提交前一律跑完整的 `npm run check`。
- **方案外两处**：`halt()` 里 `stopWatchingConfig` 的退订需要 `storage.onChanged`，失联时会抛错，已包 try；`begin()` 在 register 后 notify 并检查 epoch，扫描期间失联立即 halt，不再建监听。
- **harness**：新增 `reloadExtension()`（约 37 行，`harness.ts` 现 717 行）。首次打开 `chrome://extensions`，用 `chrome.developerPrivate.updateProfileConfiguration` 开开发者模式（不开则重载后扩展被禁用）；在 SW 里 `setTimeout` 后 `chrome.runtime.reload()`，等旧 session 移除、新 SW 挂上并 arm。约定：重载前关扩展页，重载后不对旧页面 tell。
- **新用例**：`tests/e2e/reload.e2e.test.ts` 4 条，每条开头清缓存。A 翻译进行中重载（加载点与灵岛消失，原文完整）；B 翻译完成后页面变动；C 重载后点灵岛（灵岛消失，译文保留）；收尾：重载后新页面能翻译。
- **单测**：`i18n.test.ts` 1 条（`getMessage` 抛错时 `message`/`pluralMessage` 返回空串，`uiLocale` 回落 `en`）；`session.test.ts` 1 条（`alive` 为 false 后下次通知即 halt、保留译文、不再请求，退订抛错不外抛）。

### 先红后绿
- 修复前：A、B 报 Extension context invalidated（A 另有 `reading 'onChanged'`、`reading 'getMessage'`），C 灵岛未消失，等待超时。修复后全绿。
- 变异：去掉 `lookup` 的捕获，A、C 变红；B 仍绿，因为 `alive` 先触发 halt，灵岛不会走到取文案（B 在修复前是红的）。去掉 `alive`，C 变红。

### 同类排查结果
审查者在旧隔离世界实测，失联后同步抛错的 API 有 `runtime.getURL`、`i18n.getMessage`、`i18n.getUILanguage`、`i18n.detectLanguage`、`storage.local.get`、`runtime.sendMessage`、`runtime.connect`。除 `getMessage` 外，调用点都在 async 或 try 内（`content.ts:50/68/75/96/100`、`loader.ts:20`、`config/client.ts:112`、`port.ts` 的 `post`、`languages.ts:55`），不会成为未处理错误；`storage.onChanged` 的退订已在 halt 内包 try。

### 体积
content 6.99 KB 不变，page-runtime 23.10 增至 23.14 KB，selection-runtime 18.17 KB 不变。

### 验证
lint、tsc、`npm test`（1552 个用例）、build 通过；`reload.e2e` 在 `--retry=0` 下连跑 5 次全绿；全套 e2e 在 `--retry=0` 下 11 个文件，38 通过、2 跳过。check 第 1 轮无阻断问题。

### CI 待确认
`developerPrivate` 只在本机 macOS 验证过，合并前需在 CI（ubuntu）确认 `reload.e2e` 能过。
