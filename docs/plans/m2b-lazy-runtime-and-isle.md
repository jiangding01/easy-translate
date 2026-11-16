# M2b 方案：按需加载与灵岛

> 状态：**PR1 已实现并通过 check Deep 审查，自动验收和用户手动验收均通过（附录 D）**（2026-11-16，分支 `feat/m2b-lazy-runtime`；代码审查记录见附录 C）。PR2 待原型。已拍板：加载方式选方案 A（动态 URL + 单文件按需模块）；`minimum_chrome_version` 从 117 提到 130；拆成两个 PR。
> 审查：Opus 对抗式审查一轮，阻断 1 项、应修 6 项、建议 5 项，都已吸收进正文，见附录 B。
> 依据：HANDOFF 第 5 节（M2b 开工前要决定的事项）、`docs/plans/m2-page-translation.md` 第 11 节、`docs/plans/ui-isle-direction.md`；加载方式的调研与实测见附录 A。

## 1. 目标与完成标准

M2b 分成两个 PR，各自可以独立合并：

| PR | 内容 | 合并后的状态 |
| --- | --- | --- |
| **PR1 按需加载与首屏瘦身**（第 3–7 节，可直接实施） | 内容脚本拆成「首屏引导」加「按需会话模块」；配置读取改用浏览器原生存储接口；最低版本 130；构建检查 | 用户可感知的行为不变，每个网页上的首屏脚本从 19.43KB 降到约 4KB |
| **PR2 灵岛**（第 8 节，只给框架；细节等原型确认后补到本文） | 会话订阅接口，以及灵岛的 UI、动效、停靠，放进同一个按需模块 | 唤起翻译后，页面边缘出现灵岛 |

PR1 的完成标准：

1. 内容脚本（引导）gzip ≤ 6KB。按需模块 `page-runtime.js` 单独设预算，≤ 16KB（PR2 加灵岛时再显式调整）。
2. 整页翻译的全部入口行为与 M2a 一致：工具栏面板、快捷键、「总是翻译此站」自动启动、模式切换、重试、停止。
3. 唤起前不加载按需模块：会话不存在时，`page.getState`、`page.stop`、`page.setMode`、`page.retryFailed` 都直接返回空闲状态。
4. 网页按扩展 ID 取不到 `page-runtime.js`；按需模块里不出现带扩展 ID 的资源地址，也不调用 `getURL` 或读取 `runtime.id`。两处豁免：
   - 错误文案里 Ollama 配置说明的字面量 `chrome-extension://*` 不是资源地址，允许保留；
   - wxt/browser 垫片用 `globalThis.browser?.runtime?.id` 在 `browser` 和 `chrome` 之间二选一，只读不外传，构建检查按原文精确豁免。
5. `npm run check` 全绿，包含第 6 节新增的构建检查。

## 2. 不做的事

- 不做灵岛的 UI（放到 PR2）。
- 不替换 `@webext-core/messaging`：引导层本来就需要它收消息；替换只省约 1.1KB，却要改动所有收发方。
- 不改后台和 popup 的加载方式：两者都是扩展页面，不受内容脚本预算约束。
- 不为 Chrome 130 以下版本做兜底：版本门槛由 manifest 保证。
- 不做加载失败后的原地自动重试，理由见决策 4。

## 3. 结构

```
popup / background ──(runtime 消息 page.*)──▶ 引导 content.ts → bootstrap
                                               │ 注册消息监听；auto-start 判断；会话 Promise 单例
                                               │ 需要会话时调用 loadPageRuntime()
                                               ▼
                       import(browser.runtime.getURL('/page-runtime.js'))   ← WAR, use_dynamic_url
                                               │ 模块求值时只做一件事：写入 globalThis[Symbol.for(PAGE_RUNTIME_KEY)]
                                               ▼
                       createPageRuntime({ getConfig, watchConfig, reportStatus }) → PageSession
                                               │ 模块内自建：Port（端口名来自无副作用的 port-name.ts）、视口观察器、样式读取
                                               ▼
                                    background（Port et-translate）
```

数据只沿一个方向流动：引导层把三个无状态函数注入给按需模块，按需模块返回 `PageSession`。两边之间不存在环。

## 4. 关键决策

1. **按触发时机分包，而不是按模块分包。** 会话、扫描、渲染、动态内容、Port、错误文案都是唤起后才用，所以整体搬进一个按需模块 `page-runtime`。PR2 的灵岛也在唤起时出现，放进同一个模块。M3 的划词卡片触发时机不同，到时另出一个模块。理由：在单文件约束下，每多一个包，共享代码就重复一份。
2. **按需模块用 WXT 的 unlisted script**（`src/entrypoints/page-runtime.ts`，`defineUnlistedScript`）。它默认产出匿名 IIFE 单文件，零配置，内部没有任何 import。不改成 ESM 输出：那需要 `vite:build:extendConfig` 钩子，并依赖 WXT 内部的合并顺序。模块求值时只做注册，不碰 DOM、不读配置，这样构建检查才能在 Node 里安全地执行它（见第 6 节）。
3. **跨包只共享类型和无副作用的常量。**
   - 有状态的东西（配置读取与监听、状态上报）只在引导层存在一份，通过参数注入；按需模块不得 import `@/lib/config/client` 或 `@/lib/messaging/protocol` 的运行时值。原因：`protocol.ts` 在模块顶层执行 `defineExtensionMessaging()`，会把消息库连同一个新的单例打进按需模块。
   - 为此，`TRANSLATE_PORT_NAME` 移到新文件 `src/lib/messaging/port-name.ts`。`protocol.ts` 改为从这里再导出，现有调用方不用改。
   - 引导层不得引用会话代码的运行时值，否则会被整份内联回首屏（由 6KB 预算兜底）。
4. **会话 Promise 单例 + 失败即报错。**
   - 引导层缓存的是**会话**的 Promise（`sessionPromise ??= loadPageRuntime().then((create) => create(deps))`），不只是模块的 Promise。这样并发调用方拿到的是同一个会话。
   - 加载失败时清掉 `sessionPromise`，把错误转成已有的 `network/page-unreachable`（「无法连接页面，请刷新网页后重试」），经 `handle()` 返回给面板，不新增文案。
   - 不在原地重试同一地址：浏览器的模块映射会按 URL 缓存失败结果，而动态地址在一次会话内不变，原地重试多半无效。实际的失败场景（扩展更新后旧页面的上下文失效）也只能靠刷新恢复，文案正好指向刷新。
   - 每次加载都现取 `getURL`，不缓存地址。
5. **配置读取去掉 `wxt/utils/storage`**，改用 `browser.storage.local.get(CONFIG_STORAGE_KEY)` 和 `browser.storage.onChanged`（只看 `area === 'local'` 且包含该键的变化）。
   - 键名与现在相同：`'config'`。wxt 的 `local:` 只是存储区前缀。
   - 键不存在或被删除时值为 `undefined`，经 `normalizeConfig` 处理后与现在的 `null` 结果相同。
   - 只改 `client.ts`，popup 和设置页经 `use-config` 间接受益；后台写入路径（`local-store.ts`）不动。

## 5. 消息路由（bootstrap）

「会话状态」指 `sessionPromise` 的状态：无 / 加载中 / 已就绪 / 加载失败（失败后回到「无」）。

| 消息 | 无会话 | 加载中 | 已就绪 |
| --- | --- | --- | --- |
| `page.getInfo` | 引导层直接回答，与会话无关 | 同左 | 同左 |
| `page.getState` | 返回 `IDLE_PAGE_STATE`，不加载 | 等加载完成，再返回 `session.state()` | `session.state()` |
| `page.stop` / `page.setMode` / `page.retryFailed` | 返回 `IDLE_PAGE_STATE`，不加载（M2a 中空闲会话对这三条也是直接返回状态，行为等价） | 等加载完成，再委托给会话；保证加载期间发出的停止不会丢 | 委托给会话 |
| `page.start` | 触发加载；就绪后调用 `session.start(data)`，**不等它完成**（`.catch` 吞掉），立即返回 `session.state()`，与 M2a 的 `content.ts:62-67` 一致 | 等同一个 Promise，再按左栏处理 | 同左栏（不再加载） |
| `page.toggle` | 触发加载，然后 `await session.toggle()`，与 M2a 一致 | 等同一个 Promise，再按左栏处理 | `await session.toggle()` |
| auto-start | 站点命中「总是翻译」且页面不是目标语言时，按 `page.start` 的路径启动；启动前检查 `state().phase === 'idle'`（与 M2a 相同） | 同左 | 同左 |

加载失败时，所有等待中的调用都得到 `fail(network/page-unreachable)`。

## 6. 文件改动清单（PR1：14 个代码和脚本文件，加 4 份文档，超过 8 个）

| 文件 | 改动 |
| --- | --- |
| `src/entrypoints/content.ts` | 只保留装配：调用 `createBootstrap(...)`，传入真实的 `onMessage`、加载器和 auto-start 依赖 |
| `src/content/bootstrap.ts`（新） | 第 5 节的路由，以及会话 Promise 单例；依赖全部可注入 |
| `src/content/bootstrap.test.ts`（新） | 第 5 节表格逐格覆盖，外加三类用例：加载期间连按两次快捷键，结果是先开始再停止；auto-start 与用户唤起同时到达，只加载一次、只建一个会话；加载失败返回 `page-unreachable`，下次唤起会重新加载 |
| `src/content/loader.ts`（新） | `loadPageRuntime({ getURL, importModule })`：调用 `importModule(getURL('/page-runtime.js'))` 后，从 `globalThis[Symbol.for(PAGE_RUNTIME_KEY)]` 读取工厂；缺失时报 `internal/runtime-missing`（只出现在日志和测试里，对用户统一映射为 `page-unreachable`） |
| `src/content/loader.test.ts`（新） | 每次现取地址；`getURL` 抛错（上下文失效）；模块未注册 |
| `src/content/runtime-contract.ts`（新） | `PAGE_RUNTIME_KEY` 字符串常量、`PageRuntimeFactory` 与注入依赖的类型、`IDLE_PAGE_STATE` 常量 |
| `src/lib/messaging/port-name.ts`（新） | `TRANSLATE_PORT_NAME`；`protocol.ts` 从这里再导出 |
| `src/lib/messaging/protocol.ts` | 改为再导出端口名 |
| `src/entrypoints/page-runtime.ts`（新） | `defineUnlistedScript`：只把 `createPageRuntime` 写到 `globalThis[Symbol.for(PAGE_RUNTIME_KEY)]`。工厂内部用现有的 `createPageSession`、`createPortClient`、`createStyleReader`、`createIntersectionViewport` 装配 |
| `src/content/session.test.ts` | 补一条用例：未启动时 `state()` 与 `IDLE_PAGE_STATE` 用 `toEqual` 比较相等（`state()` 带值为 undefined 的键，不能用 `toStrictEqual`） |
| `src/lib/config/client.ts` | 去掉 `wxt/utils/storage`，改用原生接口（见决策 5） |
| `src/lib/config/client.test.ts` | 补测：读取缺失的键；删除键；其他存储区或其他键的变化不触发回调 |
| `wxt.config.ts` | 加 `web_accessible_resources: [{ resources: ['page-runtime.js'], matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true }]`；`minimum_chrome_version: '130'`（注释写明原因） |
| `scripts/check-build.mjs` | 见第 7 节 |
| `scripts/check-size.mjs` | content 预算 20KB 改为 6KB；新增按需模块条目，文件路径从 manifest 的 WAR 读取，预算 16KB |
| 文档 | `CHANGELOG.md`（未发布）、`HANDOFF.md`（第 4、5 节和进度日志）、`README.md`（项目结构）、本文状态 |

不新增权限、命令、配置项或用户可见文案。

## 7. 验证

**构建检查**（`scripts/check-build.mjs`，零依赖，只用 `node:vm`）：

1. manifest：`minimum_chrome_version === '130'`；WAR 条目精确等于决策中的设置，必须带 `use_dynamic_url: true`；WAR 里列出的文件都存在。
2. 单文件、零静态 import：在产物前加 `"use strict";` 后用 `new vm.Script(code)` 只编译不运行。遇到静态 `import` / `export` 或 `import.meta` 会抛 SyntaxError，比在压缩成一行的产物上匹配字符串可靠。加严格模式，是因为 `import()` 按模块求值，而模块总是严格模式。
3. 不能再动态加载：正则 `/\bimport\s*\(/` 不得命中。
4. 注册生效：在 `vm.createContext({ chrome: { runtime: {} }, browser: { runtime: {} } })` 里按严格模式执行产物，在上下文内读取 `typeof globalThis[Symbol.for(PAGE_RUNTIME_KEY)]`，断言为 `'function'`。这一步覆盖「`main()` 被执行并完成注册」，WXT 行为变化时会在构建阶段失败，而不是上线后在运行时报错。
5. 不含扩展地址：`/chrome-extension:\/\/[a-p]{32}/`、`getURL` 不得命中；去掉 wxt/browser 垫片那一处之后，`runtime.id`、`runtime?.id`、`runtime['id']` 等写法也不得命中。

**单元测试**：见第 6 节的 bootstrap、loader、client 和 session 用例。

**真机验收**（生产构建 `npm run build`，加载 `.output/chrome-mv3`）：

1. 普通外文页按快捷键：译文正常出现，首次唤起没有可察觉的延迟。页面的 Network 面板里，`page-runtime.js` 只出现一次。
2. 打开工具栏面板但不点翻译：Network 里没有 `page-runtime.js`。
3. 「总是翻译此站」的站点：刷新后自动翻译。
4. 严格 CSP 站点（例如 github.com）：翻译正常。
5. 探测对照：
   - 在网页控制台执行 `fetch('chrome-extension://<扩展ID>/page-runtime.js')`，必须失败。
   - 在 DevTools 把上下文切到扩展的内容脚本，执行 `fetch(chrome.runtime.getURL('/page-runtime.js'))`，必须成功（阳性对照）。
6. 在扩展管理页重新加载扩展后，回到未刷新的旧标签页打开面板：面板显示「无法连接页面，请刷新网页后重试」，页面不受影响；刷新后恢复正常。
7. 顶层带 `Content-Security-Policy: sandbox` 的页面（来源是 opaque），例如 raw.githubusercontent.com 上的文本文件：验证能否翻译。若 `import()` 失败，就在 CHANGELOG 和 HANDOFF 记为已知限制，不阻塞合并。这类页面几乎都是原始文件，几乎没有整页翻译的需求。
8. 模式切换、重试、停止，与 M2a 的行为一致。
9. 不再广播扩展 ID：打开一个网页，在 DevTools 控制台执行 `addEventListener('message', (e) => console.log(e.data))`，再刷新页面（DevTools 设置里勾选 Preserve log），不应出现类型带 `content-script-started` 的消息。

## 8. 风险与回滚

- **最脆弱的假设**：WXT 把 unlisted script 产出为单文件 IIFE，`import()` 执行它时会运行 `main()`，并写入隔离世界的 `globalThis`。Fable 已在 WXT 0.21.5 + Vite 8.3.6 的最小项目里验证（本项目锁定的版本相同）。构建检查第 2、4 条在本项目里直接守住这两点，WXT 升级后如果行为变化，构建会失败。
- **首次唤起多一次模块加载**：实测 1–2ms，可以忽略。
- **sandbox 页面可能回归**：见验收第 7 条，影响面很小。
- **回滚**：revert 这个 PR 即可。不涉及存储格式和数据迁移；最低版本退回 117 也没有副作用。

## 9. PR2 灵岛（框架，原型确认后补细节）

- **会话订阅接口**：`PageSession` 增加 `subscribe(listener): () => void`，状态变化时推送。`reportStatus` 改为订阅者之一；面板的 500ms 轮询保持不变（它在扩展页面里，与本次改动无关）。
- **灵岛的代码**进入 `page-runtime` 模块，原生 TS，不用 React，挂在 closed Shadow DOM 下。样式用 `?inline` 字符串加 `adoptedStyleSheets`，图标用内联 `<svg>`，字体用系统字体。**不得引用任何扩展资源**；构建检查第 5 条同样覆盖它。
- **开工前**：先补左、右、底三种停靠方式和琥珀材质的原型最终稿，经用户确认后，在本文补写 PR2 的文件清单、动效实现与验收项，再审查一次。

## 附录 A：加载方式调研结论（2026-11-16）

| 方案 | 结论 |
| --- | --- |
| A 内容脚本 `import()` 动态 URL 的 WAR | **采用**。不新增权限，覆盖无手势场景（「总是翻译」的自动启动、M3 划词） |
| B 后台 `scripting.executeScript` | 否决。实测只有 `scripting` 权限时报 "Cannot access contents of the page"：Chromium 的 `CanAccessPage` 只看 `host_permissions`，内容脚本的 `matches` 不算。要用就得申请全部网站的主机权限，现有的自定义服务逐个授权流程会失去意义 |
| C activeTab 加注入 | 否决。activeTab 只在工具栏点击、快捷键、右键菜单后授予，覆盖不到无手势场景 |
| D `registerContentScripts` | 否决。只对之后的导航生效；没有主机权限时注册成功，但不会注入 |
| E 全部打进内容脚本 | 否决。当前已有 19.43KB，放不下灵岛 |

实测要点（Chrome for Testing 158）：

- 动态 URL 下，单文件模块能被 `import()` 加载，耗时 1–2ms。模块内部用相对路径 import 另一个文件会失败。
- 网页按扩展 ID 探测：开了动态 URL 的资源取不到，没开的能取到。严格 CSP 不影响内容脚本的 `import()`。
- 网页注册的 Service Worker 能截获 UI 加载的扩展资源（img、CSS `url()`、link、字体）的完整动态地址，closed shadow 和 CSP 都挡不住。所以 UI 中禁止出现扩展地址。
- 动态 ID 在一次浏览器会话内跨标签、跨站相同，重启浏览器后变化。

内容脚本体积构成（压缩后字符数占比）：

- `src/content/*` 约 47%；第三方依赖约 29%（其中 `@wxt-dev/storage` 加 `superlock` 23%）；`src/lib/*` 约 22%。
- 只打包首屏所需代码为 7.17KB，再去掉存储库为 3.55KB（gzip 实测）。

实验脚本在会话的临时目录里，没有入库；结论以本节为准。

## 附录 B：方案审查记录（2026-11-16，Opus 对抗式审查）

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| 阻断 | 断言「不含 `chrome-extension:`」会被错误文案里的 Ollama 说明误报 | 改为匹配带 32 位 ID 的地址，再加 `getURL`、`runtime.id`；完成标准 4 的措辞同步修改 |
| 应修 | 从 `protocol.ts` 取端口名会把消息库和单例打进按需模块 | 新增 `port-name.ts`（决策 3） |
| 应修 | 「零 import 断言就能让 WXT 变化时构建失败」说法不成立 | 构建检查第 4 条：在 `vm` 里实际执行产物 |
| 应修 | 用字符串识别压缩产物里的 import 不可靠 | 改用 `vm.Script` 编译判断（构建检查第 2 条） |
| 应修 | 四种会话状态下的路由没写全：加载中收到停止会丢、`start` 不能等待、并发会建出两个会话 | 新增第 5 节路由表；改为缓存会话 Promise |
| 应修 | 浏览器按 URL 缓存模块的失败结果，原地重试可能无效；失败文案不准确 | 不做原地重试，失败映射为 `page-unreachable`（决策 4） |
| 应修 | 原验收第 6 条在真机上走不到 `getURL` 抛错的路径 | 改为验证面板提示；`getURL` 抛错只在单测覆盖 |
| 建议 | 探测验收缺阳性对照；sandbox 页面；空闲时 setMode/retryFailed 不加载；`getURL` 带前导斜杠、按需模块路径从 manifest 读；版本号与文件数写错、`toEqual` | 全部吸收 |

## 附录 C：PR1 代码审查记录（2026-11-16，check Deep）

两位 Opus 审查者并行审查：一位做安全与架构专项，一位做四个角度的对抗式审查。主会话逐条复核了引用的代码和构建产物。

| 级别 | 来源 | 问题 | 处理 |
| --- | --- | --- | --- |
| 中（原有问题） | 安全 | WXT 内容脚本包装层默认在每个页面上 `window.postMessage` 一条类型带 `${runtime.id}` 的启动消息，任何网页监听 message 就能拿到扩展 ID | `defineContentScript` 加 `noScriptStartedPostMessage: true`；真机验收第 9 条。剩余：WXT 仍会在 `document` 上派发同名 CustomEvent，已知扩展 ID 的网页可以借它确认扩展存在，WXT 没有关闭选项，记为已知限制 |
| 低 | 安全 | 构建检查按非严格模式编译、执行产物，而浏览器按模块（严格模式）求值，存在漏报 | 编译和执行前都加 `"use strict";` |
| 低 | 安全 | `runtime.id` 断言是字面量子串，漏掉 `runtime?.id` 和 `['id']` | 改用正则，并对 wxt/browser 垫片做原文精确豁免 |
| 低 | 对抗 | 加载失败时，经 `withSession` 等待的 getState、stop、setMode、retryFailed 没有测试 | 失败用例里覆盖全部六种消息 |
| 低 | 对抗 | 「失败后下次重试」的测试和注释暗示在浏览器里能恢复，但 Chrome 按 URL 缓存失败的模块 | 测试改名、补注释，写明实际要靠刷新页面恢复 |

已确认没有问题的方面：
- 网页无法写入或抢占隔离世界里的 `Symbol.for` 槽位；
- WAR 只有一个条目；
- 按需模块产物里不含消息库和存储库；
- 引导层没有内联会话代码；
- 加载期间的并发路由与第 5 节一致（`session.start` 在第一个 await 之前就把 phase 置为 running，所以不会重复启动）。

## 附录 D：PR1 自动验收（2026-11-16）

在 Chrome for Testing 158（无头、`--lang=zh-CN`）上用 CDP 自动执行：通过扩展后台 `chrome.tabs.sendMessage` 发出与面板相同的消息，翻译走真实的 Google 端点。脚本没有入库。

| 第 7 节编号 | 结果 | 证据 |
| --- | --- | --- |
| 1 | 通过 | 从发消息到第一条译文 887ms（含加载按需模块和真实翻译），7 段译文；`page-runtime.js` 只加载一次；toggle 后 DOM 恢复 |
| 2 | 通过 | 1 次 getInfo、4 次 getState 都返回空闲，没有加载 `page-runtime.js` |
| 3 | 通过 | 写入站点记忆后，新开页面自动翻译出 7 段 |
| 4 | 通过 | 本地严格 CSP 页 105ms；github.com 上的仓库页 1457ms，12 段译文；没有异常 |
| 5 | 通过 | 网页按扩展 ID 取：失败；内容脚本取动态地址：200。网页如果拿到动态地址也能取到，与附录 A 的结论一致，这正是 UI 中禁止出现扩展地址的原因 |
| 6 | 通过（用户手动） | 重新加载扩展后，在未刷新的旧页面打开面板，显示「需要刷新这个网页」（面板已有的不可达提示）；刷新后恢复。自动化部分：旧页面 DOM 保留，没有未捕获异常 |
| 7 | 通过 | 本地页面加 `sandbox` 和 `sandbox allow-scripts` 两种响应头，都约 110ms 出译文，`import()` 成功 |
| 8 | 通过 | setMode、retryFailed、stop 的返回值和 DOM 变化符合预期 |
| 9 | 通过 | 网页监听 message 事件 3 秒，没有收到任何消息 |

用户手动验收（claude.dev 博客页）：第 6 条通过；「仅译文」和「双语」的版面观感正常。个别段落（一个等宽字体的小标题）首次显示「未译出 · 重试」，点重试后成功，属于 M2a 已有的单段失败重试路径，与本 PR 的加载方式无关。
