# M2b 方案：按需加载与灵岛

> 状态：**已合并**（PR1 按需加载 PR #8、PR2 灵岛 PR #9，2026-11-16）。审查与验收记录见附录 C–H。
> 审查：Opus 对抗式审查一轮，阻断 1 项、应修 6 项、建议 5 项，都已吸收进正文，见附录 B。
> 依据：HANDOFF 第 5 节（M2b 开工前要决定的事项）、`docs/plans/m2-page-translation.md` 第 11 节、`docs/plans/ui-isle-direction.md`；加载方式的调研与实测见附录 A。

## 1. 目标与完成标准

M2b 分成两个 PR，各自可以独立合并：

| PR | 内容 | 合并后的状态 |
| --- | --- | --- |
| **PR1 按需加载与首屏瘦身**（第 3–7 节，可直接实施） | 内容脚本拆成「首屏引导」加「按需会话模块」；配置读取改用浏览器原生存储接口；最低版本 130；构建检查 | 用户可感知的行为不变，每个网页上的首屏脚本从 19.43KB 降到约 4KB |
| **PR2 灵岛**（第 9 节） | 会话订阅接口，以及灵岛的 UI、动效、停靠，放进同一个按需模块 | 唤起翻译后，页面边缘出现灵岛 |

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

## 9. PR2 灵岛

> 状态：**已实现，通过 check Deep 审查**（2026-11-16，分支 `feat/m2b-isle`；方案审查见附录 E，代码审查见附录 F；自动验收 10 条通过，用户真机验收通过，见附录 G）；真机验收后按新原型调整底部停靠、横幅抬升、避让对齐、悬停提示和小点暗边（附录 H），已实现并经增量审查，用户复验通过。原型已确认：Design artifact https://claude.ai/artifact/GJTgsP7SFHmhP6M2SczwTp 「M2 整页翻译」页的 `IsleM2`。视觉和动效以原型为准；原型的弹簧、外形与悬停逻辑可以移植，但原型用 class 写法，移植时要改成函数。

### 9.1 目标与完成标准

唤起整页翻译后，页面边缘出现灵岛：平时是一个贴边小点，鼠标有意靠近时长成竖排（底部停靠时为横排）灵岛，在网页里直接完成双语、仅译文、结束、重试和换引擎；结束翻译后退场，页面回到零痕迹。

1. **挂载状态机**：灵岛有三种状态：未挂载、已挂载、退场中。
   - 会话 phase 离开 idle 时挂载。
   - phase 回到 idle 时进入「退场中」，播放收缩动画。
   - 退场中又收到非 idle（例如还原过程中再次按快捷键），就保留弹簧当前速度，直接反向生长回来，不先移除再新建。
   - 只有退场到位且 phase 仍是 idle，才移除宿主节点。
   - 会话 `halt()`（扩展重载后上下文失效）时也退场，网页保留已有译文，与 M2a 一致。`halt()` 不改 phase，所以 `PageState` 新增可选字段 `halted?: true`（只在停摆后出现），灵岛据此退场；面板此时本来就连不上这个旧页面，不受影响。
2. **小点状态**：贴边并离开边缘 16px，有三种状态：
   - 已翻译：琥珀色；
   - 翻译中：外圈有一段细弧在转，表示视口及其 1000px 预取区内还有段落在翻译，不显示总数；
   - 有失败或引擎级错误：珊瑚色。
3. **悬停意图**：在 `window` 上被动监听 `pointermove`，按指针到小点的距离和移动速度判断。停留 ≥ 120ms 且速度 < 0.3px/ms 才展开；按住鼠标拖动时，以及滚动后 200ms 内（与原型一致）不展开。
   - 小点本体只外扩几 px 接收点击（触屏点按展开），不放大块的透明热区，免得整个会话期间吞掉网页点击、压住内层滚动条。
   - 鼠标移开就收起；点击网页其他地方也收起：在 `window` 上监听 `pointerdown`，`composedPath()` 里不含宿主元素就算灵岛外（closed shadow 对外只暴露到宿主这一层）。
4. **灵岛内容**：
   - **「双 / 译 / 原」**：选中块沿轴弹簧滑动。「双」「译」调用 `setMode`；「原」调用 `stop`，结束本次翻译。
   - **「重试」**：在有失败段落**或引擎级错误**时出现，调用 `retryFailed`（它会同时清除引擎错误）；图标下方显示失败数，只有引擎错误时不显示数字。
   - **「引擎」**：显示当前引擎的简称，当前引擎取 `state().engine ?? 配置里的引擎`。点击后从灵岛朝页面内侧长出列表；选中某个引擎，就让**后续段落改用该引擎**（`start({ engine })`，与面板的「这次先用」语义一致，已译段落不重译）；选中当前引擎不做任何事。未就绪的引擎置灰并注明原因；有引擎级错误时，在引擎按钮上标出问题。
5. **三种停靠**：右侧（默认，60% 高度）、左侧、底部。由「灵岛位置」设置项决定，见 9.3。
   - **底部停靠落在右下角**（2026-11-16 用户真机验收后改，原为水平居中，会压住正文阅读列）：小点离右边、底边各 16px；横排灵岛以右端为锚点向左生长，宽度随按钮数变化，不超出右边缘；内容锚在右侧。
   - 引擎列表向上生长，宽约 240px，右对齐灵岛右端，多出的部分向左伸出；高度上限为视口的 60%，超出时列表内部滚动。
   - 不新增配置项；需要放到别处时，由 M3 的沿边拖动满足。
6. **宿主亮暗**：判断依据是宿主背景亮度，不看系统主题。亮色网页上是石墨深岛；暗色网页上是更亮一档的深岛，加 1px 浅描边。
7. **碰撞避让**：小点的预定位置上如果有网页自己的固定或吸附定位元素，小点沿边缘让开；展开的灵岛和引擎列表也不压住它。
   - **底部横幅抬升**（仅底部停靠）：贴底的通栏固定元素，高度不超过视口的 30% 时，小点和灵岛抬到它上方再留 8px；横幅消失后弹簧回落。超过 30% 的元素仍然忽略。
   - **与避让对象垂直居中**（仅底部停靠、发生横向避让时）：小点、灵岛和引擎列表下方的横排，中心对齐被避让元素的中心；下沿不低于离底 16px，有横幅时不低于横幅上方 8px。没有横向避让时贴底不变。位置变化走弹簧。
8. **小点不带暗边**：小点状态下，深色壳层的裁剪尺寸比琥珀圆点小一圈（壳层 8px，圆点 10px），完全藏在琥珀实心区里，避免抗锯齿时透出深色，形成 1px 暗圈（用户真机发现）；生长从这个尺寸开始。
   **动效**：小点、灵岛和引擎列表是**同一个元素**。外形由沿边长度、离边深度、圆角、沿边偏移四个量决定，rAF 驱动弹簧求值后，每帧只写 `clip-path: inset(... round r)`。
   - 弹簧参数：生长 380 / 30，收缩 520 / 42，列表 300 / 30；被打断时保留速度直接转向。
   - 内容编排：旧内容在形变前 35% 淡出，新内容在后 60% 淡入。
   - 「减少动态效果」：外形直接到位，只保留 ≤ 120ms 的透明度变化。
   - **描边**：壳层下方再放一层由同一组弹簧驱动、外扩 1px 的 clip-path 层，填描边色；每帧也只写 clip-path。
   - **阴影**：动画期间不跟随形变，只在外形静止时按最终外形摆好并淡入。这样每帧零布局，代价是生长过程中没有阴影。
9. **不打扰**：
   - 灵岛的按钮都设 `tabindex="-1"`，不进网页的 Tab 顺序；按钮在 `pointerdown` 时 `preventDefault`，不抢网页输入框的焦点。
   - 展开期间，在 `window` 捕获阶段监听 `keydown`：收到 `Esc` 只负责收起，不 `preventDefault`。
   - M2 没有让键盘进入灵岛的入口（指令台在 M3），键盘用户用面板和快捷键。这与规范第 2 节第 10 条「展开后焦点进入灵岛」不同，偏差记进规范第 7 节，留到 M3 随指令台补齐。
   - **悬停提示**：底部停靠用自绘提示（左、右停靠沿用原生 `title`）。提示显示在按钮上方 6px，水平方向夹在视口内 8px 以内。鼠标移出后先停留约 90ms，再带着文字和尺寸淡出，透明度归零后才清空内容，不留空壳；正在显示或刚收起不到 300ms 时移到另一个按钮，直接换内容和位置；打开引擎列表或收起灵岛时，同样走带文字的淡出。
   - 读屏：挂载时先放一个空的 `aria-live="polite"` 节点，下一帧再写入「开始翻译」；「翻译完成」每个会话只播报一次（phase 会随滚动在 running 和 done 之间反复切换）。
   - 打印时隐藏。全屏和模态 `<dialog>` 处在浏览器顶层，本来就盖在灵岛上面。
   - 只在顶层 frame 出现。
10. **宿主与隔离**：
    - 宿主是专属元素 `<et-isle>`，挂在 `documentElement` 下，不挂在 `body` 下，避免会话的 MutationObserver（观察根是 `body`）把它当成网页变化而全量重扫；`SKIP_TAGS` 和会话的 isOwn 判断也加上它，作为防御。
    - 宿主用内联 `!important` 写死 `position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; contain: layout paint style`，因为 `:host` 规则会输给网页对宿主元素写的选择器。
    - 壳层设 `pointer-events: auto`；clip-path 会同时裁掉命中区域，所以外形以外的部分点不到。
    - shadow 内的根节点重置继承来的 `font`、`line-height`、`letter-spacing`、`direction` 等，字体用系统字体。
11. **性能**：`will-change` 只在动画期间设置；动画期间不读布局，碰撞检测和亮暗判断在动画开始前做完。在 4 倍 CPU 降速下，展开和收起要达到 60fps。
12. **体积**：`page-runtime` 预算从 16KB 调到 26KB，内容脚本 6KB 不变。灵岛的 token 一开始就单独拆成 `tokens-isle.css`，不把扩展页面专用的 token 带进按需模块（见 9.5 第 4 条）。

### 9.2 不做的事

- ⌘ 指令台、磁吸生长、按住 ⌥ 偷看原文、快速翻译框、段落左侧的「原」按钮：M3。
- 沿边拖动小点、按站点记住位置：M3（原型没有覆盖）。
- 「外语页面提前显示小点」开关：规范第 3 节列过这一项，但它违背「被唤起之前零痕迹」，也没人要求，本批次不加，在规范第 7 节注明。
- 增强级动效（译文高度展开）：仍按 M2a 的基础级。

### 9.3 设置项：灵岛位置（新增配置字段和用户可见文案，2026-11-16 用户同意）

- 配置：`page.isleDock: 'right' | 'left' | 'bottom'`，默认 `'right'`。在 `types.ts`、`defaults.ts`、`schema.ts`（`z.enum`）和 `client.ts` 的 `normalizeConfig`（`oneOf` 兜底）里各加一处，不提升 `schemaVersion`（M0 约定：追加字段带默认值）。
  - `CONFIG_PATHS` 由 schema 派生，`config.patch` / `config.reset` 自动覆盖；旧配置读取时会补上默认值。
- 设置页「通用 · 译文」卡片新增一行「灵岛位置」：右侧 / 左侧 / 底部，用现有的分段控件样式。
- 运行中通过已注入的 `watchConfig` 实时生效：小点先收拢，再在新的边上长出来。

### 9.4 结构

```
bootstrap（content.ts）
  └─ deps: getConfig / watchConfig / reportStatus / listEngines（新）
        │
page-runtime（按需模块）
  createPageRuntime(deps)
    ├─ session = createPageSession(...)          ← 新增 subscribe(listener)
    └─ isle    = createIsle({ session, deps, env })
         ├─ 订阅 session：未挂载 / 已挂载 / 退场中（9.1 第 1 条）
         ├─ 按钮 → session.setMode / stop / retryFailed / start({ engine })
         ├─ 引擎列表 → deps.listEngines() ─(runtime 消息 engine.options)→ background
         └─ 停靠位置 → deps.watchConfig（page.isleDock）
```

数据只沿一个方向流动：灵岛只调用会话的公开方法，会话不知道灵岛的存在。引擎列表经引导层注入的函数发消息，按需模块依旧不引入 `protocol.ts` 的运行时值。

### 9.5 关键决策

1. **订阅接口**：`PageSession.subscribe(listener: (state: PageState) => void): () => void`。
   - 内部的 `notify()` 按调度函数合并，每帧最多推送一次。调度函数经 `SessionDeps` 注入，默认用 rAF，测试用假的；回调里现读 `state()`，不缓存快照，所以后台标签页的 rAF 暂停后，回到前台会补推最终状态。退订时取消已排队的回调。
   - 调用点：`report()` 的每次调用；`begin()` 置 `phase = 'running'` 处和切换引擎的分支；`setMode` 在 renderer 切换完成后；`retryFailed`；`stop()`；`halt()`。
   - 灵岛选中「当前引擎」时不调用 `start`：会话的 `begin()` 拿选中值和会话自己的 `engine` 比较，后者在没用过「这次先用」时是 `undefined`，直接调用会白白触发一次重发。
   - `reportStatus` 保持原样，它只关心四种图标状态，已有测试覆盖。
   - 先按现状推送 `state()`；如果性能测量发现 `state()` 里遍历计算 `translated` 抢占动画帧，再改成维护计数器。
2. **引擎列表走后台**：新增 runtime 消息 `engine.options`，内容脚本可以调用，只读。
   - 后台按 popup 的写法，逐个调用 `browser.permissions.contains` 查主机权限；再用 `engineEntries`、`engineReadiness` 和密钥状态计算是否就绪。
   - 返回值用白名单：`{ configured, options: [{ id, name, short, ready, note? }] }`。`configured` 是配置里的引擎；`note` 用 `NOT_READY_TEXT` 的现成文案。
   - `short` 是按钮上显示的简称，由后台生成：内置引擎用固定简称（Google → `G`、OpenAI → `AI`、DeepSeek → `DS`、Gemini → `Ge`）；自定义服务取名称的前两个字（按字素切分），未命名的用「自」。
   - 主机权限按 `engine-view` 的 `permissionPattern` 得到模式，再调用 `browser.permissions.contains`，与页面侧 `src/lib/host-permission.ts` 的判断一致。
   - 自定义服务没起名时，名称统一显示为「自定义服务」，不回落到主机名。
   - 测试断言返回值里没有 `status`、密钥尾号、地址和主机名。
   - 原因：内容脚本不能调用 `chrome.permissions`，而 `secrets.status` 只允许扩展页面调用，不能放宽。
3. **代码组织**：`src/content/isle/` 下按「纯逻辑可测」拆分：
   - `spring.ts`：弹簧步进；
   - `geometry.ts`：停靠方式 × 状态 → 四个外形量。引擎列表高度按条目数计算，有最大高度（视口的 60%），超出时列表内部滚动；底部停靠向上长时夹在视口内。
   - `intent.ts`：悬停意图状态机，时间和指针采样由参数传入；
   - `probe.ts`：碰撞探测和宿主亮暗判断（见第 5 条）；
   - `isle.ts`：DOM、Shadow DOM、rAF 循环和会话接线；
   - `styles.ts`：只导出样式字符串，挂载时才构造 `CSSStyleSheet`。模块顶层不碰 DOM，check-build 才能在没有 `document` 的 vm 里执行整份产物。
   - `createIsle` 注入 shadow 模式（测试用 open）、`raf`、`now`、`matchMedia`、`elementsFromPoint` / `getComputedStyle` 探针，让 happy-dom 能测。
4. **样式与 token**：新建 `src/styles/tokens-isle.css`，放灵岛用到的颜色、阴影、圆角和缓动 token（从 `tokens.css` **移过去**，不是复制），由 `tokens.css` 在文件开头用 `@import` 引入，保证每个值只定义一次。
   - `tokens.css` 里灵岛变量出现在三处：亮色默认块、`data-et-theme="dark"` 块和 `prefers-color-scheme: dark` 媒体查询块。`tokens-isle.css` 要保留同样的三段结构和选择器。
   - 新增 `--et-shadow-isle`，亮暗各一个值，取自原型。
   - 灵岛用 `?inline` 只引入 `tokens-isle.css`。
   - 宿主亮暗：宿主**始终显式写** `data-et-theme="light"` 或 `"dark"`，现有 `:host([data-et-theme=…])` 规则自然盖过 `prefers-color-scheme` 媒体查询，灵岛跟随网页而不是系统。
   - `scripts/check-contrast.mjs` 改为同时读两个 token 文件。
5. **探测（`probe.ts`）**：只在挂载时、窗口尺寸变化后、每次准备展开前读布局，动画过程中不读。
   - **碰撞**：用 `elementsFromPoint` 在小点和展开区域的几个采样点取元素，排除自己的宿主，沿祖先链找 `position: fixed / sticky` 的元素；命中就沿边缘移到它外侧再留 8px，并夹在视口内。沿边长度超过视口该边 50% 的元素（通栏 Cookie 横幅、通高的固定目录）沿边无处可让，直接忽略，接受重叠。
   - **亮暗**：从小点位置用 `elementsFromPoint` 取到最上层的非自身元素，沿祖先链找第一个不透明的背景色；全部透明时，看根元素的 `color-scheme`，再不行按白色处理。按相对亮度阈值判断。
   - **已知取舍**：客服气泡在小点显示之后才加载时，可能短暂重叠，下一次准备展开前会重新探测并让开，不另加观察器。

### 9.6 文件改动清单（约 26 个文件，超过 8 个）

| 文件 | 改动 |
| --- | --- |
| `src/content/session.ts` / `session.test.ts` | `subscribe`、`notify` 和注入的调度函数；测试每个调用点都会推送、同帧合并、退订、`halt` 推送 |
| `src/content/isle/spring.ts` / `.test.ts`（新） | 收敛；生长过冲约 2%；打断后保留速度 |
| `src/content/isle/geometry.ts` / `.test.ts`（新） | 三种停靠 × 小点、灵岛、列表的目标外形；列表高度上限与视口夹取 |
| `src/content/isle/intent.ts` / `.test.ts`（新） | 停留与速度阈值；拖动和滚动抑制；点击展开；移开收起 |
| `src/content/isle/probe.ts` / `.test.ts`（新） | 沿祖先链找 fixed / sticky；排除自身；超过 50% 边长的元素忽略；亮暗判断的透明回退链 |
| `src/content/isle/isle.ts` / `.test.ts`（新） | happy-dom 集成测试：挂载、退场、退场中反向生长、`halt` 退场；「重试」在失败或引擎错误时出现；按钮调用会话方法，选当前引擎不调用；`tabindex=-1` 和 `pointerdown` 不抢焦点；`Esc` 收起；读屏「开始」在下一帧写入、「完成」只播一次；减少动态效果；宿主挂在 `documentElement`，`data-et-theme` 总是显式写 |
| `src/content/isle/styles.ts`（新） | 灵岛样式字符串，不含 `url(` |
| `src/content/dom-rules.ts`、`session.ts` | `SKIP_TAGS` 加入 `ET-ISLE`，会话变动监听的 isOwn 判断（`session.ts` 约 492 行）也认它。宿主挂在 `documentElement` 下，本来就不在观察范围（根是 `body`），这两处只是防网页把它挪进 `body` |
| `src/entrypoints/page-runtime.ts` | 装配 `createIsle` |
| `src/content/runtime-contract.ts` | `PageRuntimeDeps` 增加 `listEngines` |
| `src/content/bootstrap.test.ts` | 测试夹具补上 `listEngines` |
| `src/entrypoints/content.ts` | 注入 `listEngines`（`sendMessage('engine.options')`） |
| `src/lib/messaging/protocol.ts` | `engine.options` 消息与返回类型；`PageState` 增加 `halted?: true` |
| `src/entrypoints/background.ts`，以及新增 `src/lib/translate/engine-options.ts` / `.test.ts` | 后台计算引擎选项：查权限、白名单字段、默认名称；测试就绪映射和不泄露 |
| `src/lib/config/types.ts`、`defaults.ts`、`schema.ts`、`client.ts`、`test-fixtures.ts`、`parse.test.ts`、`client.test.ts` | `page.isleDock` |
| `src/entrypoints/options/GeneralPage.tsx` | 「灵岛位置」设置行 |
| `src/styles/tokens.css`、`tokens-isle.css`（新） | 拆分灵岛 token，新增 `--et-shadow-isle` |
| `scripts/check-contrast.mjs` | 同时读取两个 token 文件 |
| `scripts/check-build.mjs` | 按需模块不得包含 `url(`（大小写敏感，不误伤 `new URL(`） |
| `scripts/check-size.mjs` | `page-runtime` 预算改为 26KB |
| 文档 | `CHANGELOG`、`HANDOFF`、本文状态与验收记录；`ui-isle-direction` 第 7 节写明落地状态，以及与第 2 节第 10 条、第 3 节的两处偏差 |

### 9.7 验证

**自动化**：`npm run check` 全绿：上面每个新文件都有测试，构建检查新增 `url(` 断言，体积预算生效。

**真机验收**（生产构建；能自动化的先用 Chrome for Testing 跑一遍，副本放在临时目录，不碰 `.output`；其余由用户在 Chrome 中操作）：

1. 亮色网页、暗色网页各一个（claude.dev 博客，以及一个 html 和 body 透明、颜色画在包裹层上的暗色单页应用），三种停靠方式都试：观感与原型一致；系统切到暗色时，亮色网页上的灵岛仍是石墨色。
2. 快速划过小点不展开；停留后展开；拖动网页滚动条经过小点时不展开；小点附近的网页内容照常可以点击。
3. 双 / 译 / 原、重试（断网制造失败后恢复网络）、换引擎（含一个未配置的引擎置灰、一个引擎级错误）都能用；面板状态与灵岛一致。
4. 有客服气泡的网站：小点和展开的灵岛都不压住气泡；带通栏 Cookie 横幅的网站上，小点不乱跳。
5. 在 DevTools 的 Performance 面板里开 4 倍 CPU 降速，录制展开、收起和列表展开：没有掉帧，帧时间 ≤ 16.7ms。
6. 打开「减少动态效果」后，外形直接到位。
7. 打印预览里看不到灵岛；视频全屏时灵岛被盖住。
8. 在网页输入框里打字时点灵岛按钮，输入框焦点不丢；Tab 走遍网页，焦点不进入灵岛；读屏「开始翻译」「翻译完成」各播报一次。
9. 按 `⌃⇧A` 结束翻译后，DOM 里没有 `<et-isle>`；还原过程中再按 `⌃⇧A`，灵岛反向长回，不闪烁。
10. 设置页切换「灵岛位置」，正在翻译的页面上灵岛移到新的边。

### 9.8 风险与回滚

- **最脆弱的假设**：`clip-path` 加 rAF 弹簧在 4 倍降速下能跑满 60fps。如果不成立，按 `ui-isle-direction` 第 5 节第 3 条退回 transform 方案（外层 `scale` 加内层反向 `scale`，圆角用 SVG）。这个退路只影响 `isle.ts` 的渲染函数，几何和弹簧层不变。
- **体积**：拆分 token 后，预计仍有约 3–5KB 余量。如果超出 26KB，先查是什么占了体积，再决定压缩还是调整预算，不默默放宽。
- **回滚**：revert。`page.isleDock` 是追加的带默认值字段，旧版本会忽略它，不需要迁移。

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

## 附录 E：PR2 方案审查记录（2026-11-16，Opus 对抗式审查）

阻断 3 项、应修 14 项、建议 4 项，全部吸收进第 9 节。主会话抽查了 `tokens.css` 的媒体查询、`engineReadiness` 的输入和自定义服务名称的回落写法，确认属实。

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| 阻断 | `tokens.css` 只认 `data-et-theme`，系统为暗色时，亮色网页上的灵岛会变成暗色方案 | 宿主始终显式写 `data-et-theme`（9.5 第 4 条） |
| 阻断 | `engine.options` 缺主机权限输入，导致自定义服务整排置灰；未命名时名称回落为主机名；`status` 带密钥尾号 | 后台逐个查权限；名称统一为「自定义服务」；返回值白名单（9.5 第 2 条） |
| 阻断 | 运行中 `start({ engine })` 只影响后续段落，与「以该引擎重新翻译」不符；当前引擎来源错误 | 文案改为「后续段落改用该引擎」；当前引擎取 `state().engine ?? 配置` |
| 应修 | 通知点不全；rAF 暂停可能丢状态 | 列出调用点；回调里现读 `state()`；调度函数可注入 |
| 应修 | 还原期间再次唤起时，灵岛的退场与重新出现冲突 | 三态挂载状态机，退场中反向生长 |
| 应修 | 宿主挂在 body 下会触发全量重扫；`:host` 样式会输给网页选择器 | 宿主挂到 `documentElement`，加入 isOwn；内联 `!important` |
| 应修 | `contain: paint` 与壳层布局冲突 | 宿主 `inset: 0`，壳层单独接收指针 |
| 应修 | 阴影层每帧写尺寸会触发布局；描边没有 token | 阴影只在静止时出现；描边改为一层 clip-path；新增 `--et-shadow-isle` |
| 应修 | 透明热区会吞掉网页点击并压住滚动条 | 改为在 window 上监听 pointermove 计算距离 |
| 应修 | Esc 收不到；点按钮会抢走输入框焦点；与规范第 2 节第 10 条不一致 | 在捕获阶段监听 keydown；`pointerdown` 时 `preventDefault`；偏差记入规范 |
| 应修 | aria-live 的时机：「开始」会丢，「完成」会反复播 | 先放空节点、下一帧再写；「完成」每会话只播一次 |
| 应修 | 引擎级错误在灵岛上没有任何表现 | 有引擎错误时也显示「重试」，并在引擎按钮上标出问题 |
| 应修 | 碰撞探测会命中子元素或 iframe；通栏元素无处可让 | 沿祖先链判断；超过边长 50% 的元素直接忽略 |
| 应修 | 引擎列表高度固定，条目多时会出界；数据异步；简称没有来源 | 按条目数计算高度并设上限；展开时预取；由后台给出 `short` |
| 应修 | 亮暗判断：背景画在包裹层上时找不到 | 从小点位置的最上层元素开始沿祖先链找 |
| 应修 | 可测性：closed shadow、没有布局、vm 里执行产物 | 依赖可注入；样式模块顶层不碰 DOM |
| 应修 | `halt()` 后灵岛滞留在页面上 | `halt` 时退场 |
| 建议 | 文件清单有遗漏；`state()` 的计算成本；体积余量；文中残留和不一致 | 补全清单；先测量再优化；拆分 token；修正残留文字 |

第二轮自查（主会话对照代码复核修订稿）补了 4 处：
- `halt()` 不改 phase，灵岛无从得知会话已停摆：`PageState` 增加 `halted?: true`。
- 选中当前引擎时，如果直接调用 `start`，会因为会话的 `engine` 为 `undefined` 而触发一次重发：改为由灵岛先比较，相同就不调用。
- 简称规则原先没写：已补上。
- isOwn 的实际位置在 `session.ts`，不在 `dom-rules.ts`：已更正；同时写明 `tokens-isle.css` 要保留三段主题结构。

## 附录 F：PR2 代码审查记录（2026-11-16，check Deep）

两位 Opus 审查者并行审查：一位做安全与架构，一位做对抗式。主会话对照代码复核了停靠切换和换引擎两处。修复由子代理完成，每条都先写回归测试，确认在旧代码上失败后再修。

| 级别 | 来源 | 问题 | 处理 |
| --- | --- | --- | --- |
| 中 | 两位都发现 | 停靠位置在收拢途中改回原边，灵岛停在 gone，整个会话都看不见；退场中改了停靠又在同一帧重启，也会卡住 | 已挂载时，静止后一定回到小点；退场判断改用灵岛已应用的状态 |
| 中低 | 对抗 | 换引擎后，旧引擎在途请求的引擎级错误会让会话暂停，新引擎一段都发不出去（面板「这次先用」同样受影响） | 请求记下发出时用的引擎；只有当前引擎的错误才暂停，其余段落改用当前引擎重发 |
| 低 | 安全 | window 上的监听不检查 `isTrusted`，网页能伪造指针事件让灵岛展开 | 忽略不可信事件（判断可注入，便于测试） |
| 低 | 对抗 | 首次唤起时，模式指示要等第一次上报才纠正 | 渲染器切好模式后立即推送 |
| 低 | 对抗 | 每次推送都无条件重写文字和标签 | 值变了才写 |
| 测试 | 对抗 | 用例从不 `destroy()`，泄漏测不出来；halt 推送和 isOwn 分支的测试是空心的；「快速划过」没测到速度 | 每个用例结束都销毁并断言零残留；改写空心测试；补测停靠来回切换、列表获取失败、回包时已卸载、resize |

修复中顺带发现并修复：
- 开始播报用的 rAF 在卸载时没有取消；
- 在配置返回之前就销毁，之后仍会订阅配置；
- `destroy()` 不能重复调用。

还没做：`state()` 每次推送都要遍历全部段落（O(段落数)），按 9.5 第 1 条「先测量再改」暂不处理。

验证：`npm run check` 共 633 个测试，其中时序敏感的 `cache.test.ts` 偶发失败一次，单独重跑通过（已知问题，见 HANDOFF）；page-runtime 21.34KB，content 4.96KB。

## 附录 G：PR2 自动验收（2026-11-16）

环境：Chrome for Testing 158，无头模式，`--lang=zh-CN`，用 CDP 驱动；加载产物副本，不碰 `.output`。交互用 `Input.dispatch*` 产生可信事件。全程未捕获异常和 console error 均为 0。

| 9.7 编号 | 结果 | 证据 |
| --- | --- | --- |
| 1 | 通过 | 亮色页、暗色单页应用（背景画在 `#root` 上）各试三种停靠；系统切到暗色时，亮色页上的灵岛仍是石墨色 |
| 2 | 通过 | 快速划过（每毫秒 21–91px）不展开；慢速停留后展开；小点旁边网页按钮的点击照常生效 |
| 3 | 通过 | 「译」「双」「原」都生效；断网制造 7 段失败，出现「重试 7」，恢复网络后重试，全部译出；未配置密钥的引擎置灰并注明原因 |
| 4 | 通过 | 小点让开了客服气泡；有通栏横幅时小点不跳动 |
| 5 | 仅供参考 | 4 倍 CPU 降速，用 rAF 测帧间隔：展开、列表、收起的最大值都是 16.8ms（无头模式，没用 Performance 面板） |
| 6 | 通过 | 减少动态效果时，第一帧就是最终外形 |
| 7 | 通过 | 打印媒体下看不到灵岛 |
| 8 | 通过 | 点灵岛时输入框焦点不丢；Tab 40 次，焦点从未进入灵岛 |
| 9 | 通过 | 结束翻译后 DOM 里没有 `<et-isle>`；start 和 stop 交替快速触发，最终状态正确 |
| 10 | 通过 | 运行中切到左侧生效；切到底部后在 100、50、20ms 内切回右侧，灵岛都可见 |

已知取舍：底部停靠时遇到通栏底部横幅（Cookie 横幅），小点叠在横幅上（按 9.5 第 5 条，超过边长一半的元素直接忽略）。

用户真机验收（2026-11-16，Chrome 生产构建）：
- 9.7 第 1、2、4、5 条通过。第 5 条：Performance 面板开 4 倍 CPU 降速，在 claude.dev 文档页上 LCP 0.72s、CLS 0.02、INP 40ms。
- 第 3 条部分通过：双 / 译 / 原、重试、换引擎正常；「引擎级错误」的外观没有手测，由单元测试覆盖。
- 底部停靠叠在通栏横幅上：保持现状。

## 附录 H：真机验收后的调整（2026-11-16）

用户在 Chrome 中验收时发现三个问题，改原型确认后再改代码：
- 底部停靠水平居中会压住正文阅读列：改为右下角，横排向左生长，列表右对齐。
- 底部停靠时，小点叠在通栏横幅上；让开客服气泡后，小点挂在气泡的左下角：增加横幅抬升，以及与避让对象垂直居中。
- 原型的自绘提示在鼠标移出时会闪出空胶囊；琥珀小点有 1px 暗圈。改为带文字淡出；壳层比圆点小一圈。

原型：Design artifact 的 `IsleM2` 页（第 33 版）。

实现（Opus 子代理）后做了增量审查（Opus），发现 5 项，全部修复，并各有先失败后通过的回归测试：
- 【中】琥珀圆点移到壳层之上后，不再随形变缩放：退场时最后一帧突然消失，换停靠时瞬移。改为与壳层同心缩放（`min(L, D) / 8`，上限 1），挂载前缩放为 0。
- 【中低】横幅判断用的是「露出视口的高度」，没吸住的 sticky 也被当成横幅。改为看元素自身高度、必须贴底、sticky 须吸附在底部、横向覆盖小点所在的列。
- 【低中】垂直居中没有上限，满高的侧栏会把小点带到视口中部。改为只在被避让元素高度和抬升量都不超过 30% 视口时对齐；列表放不下「表头 + 3 行 + 表脚」时退回地板；底部感应区改为以小点为中心的固定框。
- 【低】提示在动画期间读取布局。改为静止时缓存按钮偏移。
- 【低】提示显示期间，按钮位置或标签变化后不跟随。现在会跟随更新。
- 补测试：提示在三个阶段分别遇到 destroy、退场、换停靠时，都断言零残留。

另有一处方案之外的修复：展开时记住指针原先所在的感应区，防止横幅消失后、弹簧落位产生的合成鼠标事件让灵岛立即收起。

已知残留（低）：外形静止时定位提示，仍要读一次提示框自身的宽高；形变中从一个按钮直接换到另一个按钮时，旧提示会停留到形变静止。

验证：`npm run check` 全绿，共 682 个测试；page-runtime 23.17KB。

