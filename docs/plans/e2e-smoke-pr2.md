# 冒烟 e2e PR2 方案

> 状态：已合并（#48，2026-11-18）。2026-11-18 用户批准。方案经 Opus 对抗式审查后修订（审查在本机实测了 harness 三项改动与 13 号用例）。总方案见 `docs/plans/e2e-smoke.md`（PR2 节）；第 17、18、24 条已随修复 PR 提前完成。

## 目标
1. 查清并修掉已出现过的偶发失败。
2. 补齐 PR2 剩余用例中产品已实现、能稳定自动化的部分。
3. 让 CI 能看见「重试后才通过」。
4. 满足条件后，把 `e2e` job 设为 `main` 规则集的必过检查。

## 先修：已出现的偶发失败
审查发现 e2e 并非「连续 8 次无偶发失败」：job 134668469020（样式精确恢复的 PR 运行）里，`action panel > opens, renders… (zh_TW)` 首次失败，靠 `vitest.e2e.config.ts` 的 `retry: 1` 重跑才通过，因此 job 显示绿色；首次失败的错误没有打印，失败产物只在 `if: failure()` 时上传，也没留下。
- 本 PR 第一步：本地用 `--retry=0` 把 `ui.e2e.test.ts` 的面板用例循环跑 30 次复现，读 `chrome.action.openPopup()` 与 `waitForExtPage` 的时序（面板是否在 zh_TW 构建下打开更慢、或上一条用例的面板未关闭），定位根因后修复；修复后同样 30 次 `--retry=0` 全绿。
- CI 可见性（同在本 PR）：retried reporter 对每个重试过的用例输出 `::warning::` 注解并打印首次失败的错误；失败产物上传改为 `if: always()`（保留 `if-no-files-found: ignore`），重试过的用例也有截图与日志。`retry: 1` 保留，避免设为必过后被基础设施的偶发问题卡住；「重试后才通过」从此在 CI 上可见并计为偶发失败。

## 用例（编号沿用总方案）

| # | 用例 | 关键断言（防空） | 变异验证（必须变红） |
|---|---|---|---|
| 9 | 仅看译文布局：`translation-only-layout.html` 非「已知限制」各节 | 根元素带 `data-et-only`；切到仅看译文后用 `setViewport` 换一个宽度，与双语在同一宽度下的根元素宽度和左边界对比（容差 0.5px），覆盖 auto 外边距与百分比内边距被钉成像素的回归；`et-tr` 计算出的 letter-spacing / word-spacing 与原文一致；切回双语后原文布局复原 | 把 Typed OM 读取改回 `getComputedStyle` 像素值（钉 auto / 百分比） |
| 10 | 动态内容 | 并入 `page.e2e.test.ts` 已有的编辑区用例：对照段落除出现在请求里，还要断言已渲染出【MOCK】译文 | 去掉 `watch()` 启动 |
| 11 | 总是翻译此站 | options 页发 `site.setAlways` 后重载外语页，自动开始翻译（translated 计数增加）；`finally` 里 `setAlways(false)`，避免影响同浏览器后续用例 | `auto-start.ts` 判定函数开头直接 `return false`（或不调用 `deps.start()`） |
| 12 | 引擎错误 403 | `/t` 与 `/single` 都返回 403；`getState().engineError.code === 'provider/unauthorized'`；灵岛 shadow 内出现错误文案；恢复 mock、调 `retryFailed` 后翻译恢复完成 | 去掉 `session.ts` 逐条结果的 engine 级错误分支（约 :474）；整请求级分支（约 :519）不经此路径 |
| 13 | SW 被停后继续 | 停 SW 前首屏已缓存，所以停后插入一段全新文本，断言请求数增加且渲染出【MOCK】译文；放在文件最后 | 去掉 harness 在新执行上下文上重开拦截（`armWorker`），用例应因未拦截请求而失败 |
| 14 | #30 丢标签改 HTML 模式重试 | 纯文本请求回复去掉标签，HTML 请求保留；断言确实发生过 HTML 请求，且译文里链接存在 | `repairTags` 触发条件改为永不触发 |
| 21 | 仅看译文下退回纯文本的段落原文不露出（与 14 同文件） | HTML 请求也丢标签；根元素带 `data-et-only`，原文文本节点宽度为 0 | `canBeOnly` 里重新排除丢标签的段落（回退 266af38） |
| 22 | 快速「停止 → 再开始」 | 用慢回包让停止发生在请求进行中；最终每个根元素恰好一个 `et-tr`、translated 计数正确、无错误（不以 `google.texts` 为同步点：第二次开始会命中缓存） | 去掉 `begin` 里的 `await stopping` |
| 23 | Google 原样回显自动重试 | 回显段落达到回显阈值（≥4 个英文词、≥20 个字母、≥2 个小写词，不含 `=<>{}`）；`/t` 原样返回、`/single` 返回译文；断言发生过 `/single` 请求且 `et-tr` 含【MOCK】 | 关掉 `retryEchoed` |
| 16 | 面板真实链路 | popup.html 以普通标签页打开，导航前注入脚本替换 `chrome.tabs.query`（`browser` 与 `chrome` 两个对象都替换），面板显示测试页地址；点「翻译此页」后测试页翻译完成 | 注入脚本不替换（面板应显示「无法翻译此页」） |

## 不做（写明原因）
- **19 初扫期间插入内容被翻译**：已在 M3d PR-B2（#55）启用。做法：harness 在内容脚本的隔离世界包装 `scheduler.yield`，首次让出时插入内容，保证插入发生在初扫中途；不依赖真实时序。
- **15 翻译中途重载扩展**：产品侧已处理，但 harness 需要支持「SW target 被销毁再新建」与扩展页全部关闭重开，headless 下 `chrome.runtime.reload()` 的稳定性未验证。单独开一个小 PR，此前保留为手工验收项。
- **20 灵岛改变视口宽度时贴边**：`isle.test.ts` 已有逐帧断言同一行为的单测（随 #36 加入）；e2e 要可靠测出需在页面内挂 resize 与 rAF 记录逐帧位置，收益低、易误报，不做。
- **不换 `playwright-core`**：它对 MV3 扩展 SW 的网络拦截与 SW 的 CDP 会话没有可靠支持，核心 mock 仍要自写 CDP。退出条件改为「出现压不住的偶发失败（含重试后才通过）」，不再以行数为准。

## harness 改动（约 +50 行）
1. `GoogleHandler` 增加第二个参数 `{ html: boolean; single: boolean }`：`html` 由 `/translate_a/t` URL 的 `searchParams.get('format') === 'html'` 判定，`single` 为 GET `/translate_a/single`。既有 handler 不受影响。
2. `setViewport(width, height)` / `clearViewport()`：对测试页 session 发 `Emulation.setDeviceMetricsOverride` / `clearDeviceMetricsOverride`；视口覆盖在导航后仍有效，用到的用例在 `finally` 里清除。
3. `extPage(path, { preload })`：先以 `about:blank` 建 target、attach、`Page.enable`、`Page.addScriptToEvaluateOnNewDocument(preload)`，再导航到扩展页；导出 harness 已有的测试页 `tabId`；`ExtPage.close()` 容忍目标已不存在（面板开始翻译后会自己 `window.close()`）。
4. `trackTests` 的 `beforeEach` 统一 `mockGoogle()` 复位，避免一条用例失败把 handler 漏给下一条。

## 文件组织与隔离
新增 `layout.e2e.test.ts`（9）、`google.e2e.test.ts`（14、21、23、12）、`session.e2e.test.ts`（11、22、13，13 放最后）；10 并入 `page.e2e.test.ts`；16 并入 `ui.e2e.test.ts`。`google`、`session` 两个文件每条用例前清缓存（沿用 `support.ts` 的 prepare）。CI 预计 e2e job 由约 1 分钟增至约 1.5 分钟（超时 10 分钟）。

## 稳定性要求
- 所有等待用 `waitFor` 轮询最终状态，不断言动画中间态。
- 每条新用例与修复后的面板用例本地 `--retry=0` 连跑 5 次全绿（面板用例 30 次）才算完成；13、16 若做不到，降级为本 PR 不收录、写进待办。

## 设为必过（最后一步，需用户确认）
- 条件：偶发失败修复后，e2e 连续约 10 次**未经重试**全绿（以本 PR 起 CI 的 `::warning::` 注解为准）。本 PR 合并时若次数不够，先合并，满足后再设。
- 做法：在 `main` 规则集（GitHub 仓库设置 → Rules → `main protection`）的 required status checks 中加入 `e2e`。这是仓库设置改动，由用户在 GitHub 上操作，或明确授权后由我用 `gh api` 修改。
- 本 PR 内删掉 `ci.yml` e2e job 上「首版不设为必过」的注释，改为说明设为必过的条件。

## 文档
`docs/plans/e2e-smoke.md`：PR2 实施记录、退出条件改写、15 / 19 / 20 的去向；本方案补实施记录；README 双语的 CI 说明；CHANGELOG；HANDOFF。

## 最脆弱的假设
「面板用例的偶发失败能在本地复现并定位」。若 30 次循环都复现不了，本 PR 只合入 CI 可见性改动和新用例，「设为必过」推迟到 CI 上积累到足够的未经重试的全绿记录、或抓到首次失败的错误信息之后。

## 回滚
revert 本 PR；只改测试、harness、CI 与文档，不改扩展源码（偶发失败若查明是产品缺陷，修复另行说明）。规则集的必过设置在 GitHub 上移除 `e2e` 即可。

## 分支
`feat/e2e-smoke-pr2`

## 实施记录（2026-11-18）

### 偶发失败的根因与修复
- 根因：面板用例的等待条件弱于断言。面板打开后先经过「正在載入…」「正在讀取頁面…」两个过渡态，旧的等待条件在过渡态就放行，随后的断言读到的不是最终文案。用 CPU 节流可稳定复现。
- 修复：等待条件改为等到 blocked 文案出现。
- 验证：修复后 `--retry=0` 连跑 30 次全绿；旧版在节流下跑 16 次，失败 1 次。

### CI 可见性改动
- 重试过的用例输出 `::warning::` 注解（用例名里的换行做转义），并打印首次失败的错误。
- 失败产物上传条件由 `if: failure()` 改为 `if: ${{ !cancelled() }}`：失败或重试过的用例都上传，取消时不上传；重试产物另存目录。
- `retry: 1` 保留。

### harness 改动
`tests/e2e/harness.ts` 由 627 行增至 680 行，即方案中的四项：`GoogleHandler` 第二个参数、`setViewport` / `clearViewport`、`extPage` 的 `preload` 与导出 `tabId`、`trackTests` 复位 mock。另有两处：`fulfillGoogle` 忽略 `Invalid InterceptionId`（拦截在请求已被取消时失效，属正常竞态）；`ExtPage.close` 只容忍「目标已不存在」类错误，其余照常抛出。

### 用例与变异验证
- 10 条用例按上表落地：布局（9）、动态内容（10，并入 `page.e2e.test.ts`）、总是翻译此站（11）、引擎错误 403（12）、SW 被停后继续（13）、丢标签改 HTML 模式（14）、仅看译文下丢标签（21）、快速停止再开始（22）、原样回显重试（23）、面板真实链路（16，并入 `ui.e2e.test.ts`）。
- 变异验证按上表逐条做，每次验证后精确还原，`git diff -- src/` 为空。结果（实现时与 check 第 1 轮审查时实测）：

| # | 变异 | 结果 |
|---|---|---|
| 9 | Typed OM 读取全部改回 `getComputedStyle` | 红（`.centred left` 差 200px）；check 第 1 轮后加强内容盒比较，只把 `padding-*` 改回像素也红（`.padded content width` 差 40px） |
| 10 | `watch()` 换成空函数；另做定向变异让对照段落不渲染 | 前者红在原有「已发送」等待；后者只有新加的渲染断言变红 |
| 11 | `startIfRemembered` 开头 `return false` | 红（等待自动翻译超时） |
| 12 | 逐条结果的 engine 级错误分支（约 `session.ts:474`）恒为假 | 红；整请求级分支（约 `:519`）去掉仍绿，403 不经此路径 |
| 13 | harness 去掉新执行上下文上的 `armWorker` | 红（新段落一直不翻译） |
| 14 | `repairTags` 提前 return | 红（14 与 21 两条） |
| 21 | `canBeOnly` 排除带标签的段落 | 红（等 `#linked` 进入仅看译文超时） |
| 22 | 去掉 `begin` 里的 `await stopping` | 红（`only` 为 false，连跑 3 次都红） |
| 23 | `retryEchoed` 提前 return | 红（没有 `/single` 请求） |
| 16 | preload 置空 | 红（面板不显示测试页） |

### 与方案的差异
- 22 号改为「在旧会话仅看译文钉值未还原时启动」，才能抓住 `begin` 里的 `await stopping`；原写法的慢回包在去掉它后仍然是绿的。
- `fulfillGoogle` 忽略 `Invalid InterceptionId`：请求已被取消（例如停止的会话）时再响应会报此错，与用例结果无关。
- `ExtPage.close` 只容忍目标不存在，不再吞掉全部错误。

### check 第 1 轮发现与修复
| 项 | 级别 | 问题 | 修复 |
|---|---|---|---|
| A | 中 | 布局用例只比边框盒，`.padded` 宽度为 auto，测不出百分比内边距被钉成像素 | 同时比较内容盒的宽度与左边界（容差 0.5px）；变异验证：只把 `padding-*` 的 Typed OM 读取改回 `getComputedStyle`，用例变红（`.padded` 内容宽度差 40px）；还原后 `git diff src/` 为空并重新 build |
| C | 低 | 403 用例名含「once」，没有断言只一次 | 读屏播报的文本会被覆盖，次数无法稳健断言，去掉用例名里的 once |
| D | 低 | 会话用例注释称验证「迟到回包不改变结果」，实测被停请求已被取消，回包到不了页面 | 改写注释如实描述，删掉固定的 300 毫秒 sleep（删后连跑稳定） |
| E | 低 | `ExtPage.close` 吞掉所有错误 | 只忽略 `No target with given id` / `Target closed` |
| F | 低 | 产物上传 `if: always()` 会在取消时也上传 | 改为 `if: ${{ !cancelled() }}` |
| 另 | 低 | 重试汇总里用例名含换行会打乱输出 | 普通输出行的用例名对换行转义，只影响显示 |

### 稳定性实测
- CPU 节流 6x、20x，加主机压满，连跑全绿。
- 修复后：layout、google、session 三个文件各 `--retry=0` 连跑 3 次全绿；整个套件 `--retry=0` 连跑 2 次全绿。无残留 Chrome for Testing 进程与 `et-e2e-*` 临时目录。
- e2e 现为 10 个文件、33 通过、2 跳过（Linux 才跑的 `--lang` 回退用例），约 37 秒。

