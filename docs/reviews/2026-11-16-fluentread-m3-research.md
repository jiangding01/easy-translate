# FluentRead 调研：M3 相关机制（2026-11-16）

> 来源：[FluentRead](https://github.com/FluentRead/FluentRead) 的本地克隆，由 Sonnet 子代理只读调研。只借鉴思路，不搬代码。下文路径相对于该项目，`S` 代表 `src/features/selection-translation`。
> 用途：为 M3a–M3e 各批次做方案时查阅。行号是调研当时的快照，引用前要重新核对。

## 1. 划词翻译

- **触发方式**：图标、小点、悬停图标、直接弹出、仅右键菜单、修饰键、自定义快捷键，可配置（`src/core/config/catalog.ts:600-610`）。在 document 的捕获阶段监听 pointerdown、pointerup、selectionchange、keydown、scroll（`S/ui/SelectionTranslator.vue:2741`）。
- **触发条件**：
  - 选区上限 4096 字符；**没有最短长度限制**（缺陷：单个字符也会出现图标）。
  - 目标语言是中文时，跳过纯汉字选区；同语言判断用 franc-min 加本地统计。
  - 从右键菜单触发时，强制翻译。
  - 输入框和可编辑区默认排除，选区完整落在一个可编辑宿主内时才放行（`S/core.ts:388`）。
- **挂载**：closed Shadow Root 单例，z-index 2147483646；用 `mountRequestId` 代次防止旧 Promise 污染新实例；只观察宿主的祖先链，页面重建时有界修复，最多 2 次（`S/content/runtime.ts`）。
- **定位**：纯函数（`S/core.ts:570-600`）。优先放在上方，不够时放下方，两边都不够就选空间大的一侧并限高；在视口内夹取；补偿页面缩放；避让**整个选区的纵向范围**，而不只是锚点所在的行。
- **关闭**：页面内 pointerdown、Esc、滚动（可配置）时关闭；记住 `dismissedSelection`，同一个选区不会被重新弹出（`vue:2148`）。
- **迟到响应**：每次请求新建 AbortController 并中止旧请求，同时递增 requestId；返回后校验来源仍是当前选区；`isSameSelection` 比较文本和 Range 边界；失去选区后有 160ms 宽限（`vue:1521-1555`）。
- **缺陷**：单个文件 3100 行；没有固定卡片；**划词结果不流式**。

## 2. 流式输出

划词结果是一次性返回的。只有「阅读助手」用 Port 流式传输：`{ type: 'progress' | 'result', requestId }`。取消时先在本地断开 Port，再通知后台；后台在标签页关闭或跳转时取消该标签的请求（`src/features/reading-assistant/client.ts`、`src/app/background/harnessRuntime.ts`）。

## 3. 词典态

- **触发条件**：选区是单个英文单词，且目标语言不是英文。
- **数据**：`S/services/wordDictionary.ts`，约 900 行，6 个来源：
  - 本地：内置 ECDICT 词库，可选下载完整版（固定 commit，校验 SHA-256）；
  - 在线：有道、dictionaryapi.dev、wiktapi、Wiktionary、Datamuse。
- **查询策略**：本地优先，在线来源并发查询，共用一个截止时间。分两阶段：先显示原文词条（3.5s 超时），再补充译文释义。
- **结论**：词典是一个独立的大子系统。

## 4. 朗读

在线 Edge TTS（后台取 token）和 Google，最后回退到页面的 `speechSynthesis`。在 offscreen 文档里播放，绕过页面 CSP。路由身份（标签、frame、文档、请求 ID）不放在 SW 内存里，因为 SW 随时可能被回收。

## 5. 悬停译段与仅译选区

- **悬停译段**：默认修饰键是 Control。同一个候选段落上继续移动时只更新坐标，到期后再确认一次命中，防止滚动后翻成别的段。渲染复用整页翻译的双语节点。正在编辑或使用输入法时优先，不触发。
- **仅译选区**：有有效选区时，快捷键归划词使用。「局部翻译」进入选择模式后，点选块级容器，可以逐级扩大范围（`features/section-translation`）。

## 6. 右键菜单与快捷键

- **右键菜单**：共 5 项（翻译选区、图片、页面、区域、切换站点），每个场景只放一个直达项，不注册 link 上下文；重建时用队列串行执行，避免竞态（`app/background/contextMenuRuntime.ts`）。
- **快捷键**：没有使用 `chrome.commands`，全部是页面内的 keydown，所以页面失焦或焦点在输入框里时不生效。
- **macOS Option 键**：优先用 `event.key`；遇到 Option 产生的特殊字符或死键，回退到 `event.code`；keyup 时按 code 找回按下时记录的逻辑键（`src/core/hotkey/index.ts:101-151`）。

## 7. 动态页

- **单页应用**：在 MAIN world 用 `document_start` 注入脚本，包装 pushState 和 replaceState，并监听 popstate、hashchange、Navigation；只有 href 真正变化时，才向隔离世界派发事件，由隔离世界统一取消旧请求并重新扫描（`src/platform/shadow-ui/pageBridgeCore.ts`）。
- **Shadow DOM**：同一个 MAIN 脚本包装 `attachShadow`，逐层发现 open root；**不穿透 closed root**。
- **iframe**：只对白名单站点注入（`entrypoints/supportedFrame.content.ts`）；通用的 iframe 扫描没有实现。
- **MutationObserver**：合并脏根，突发变化超过阈值时切换为宽范围根；重扫至少延迟 50ms 并带冷却；1800ms 的来源稳定窗口内，只有数字变化的短标签保持原文。
- **风险**：MAIN world 补丁会侵入页面。

## 8. 站点规则

声明式 JSON（版本 1，profiles 加 rules），每条规则含 `match`、`mode`、`content`、`protect`、`exclude`，严格校验（`src/core/site-adaptation/schema.ts`，内置约 135KB）。用户规则可以覆盖或停用内置规则。少数站点（Mastodon、X、BBC 等）有专用的 TS 适配代码。没有远程下发。站点名单匹配用 tldts 取主域名（eTLD+1）。

## 9. Chrome 内置 Translator / LanguageDetector

- **运行位置**：在 offscreen 文档中运行（`src/app/offscreen/translation.ts`），只在 Chrome 上启用。
- **语言包**：先检查 `availability`；下载中通过 `downloadprogress` 上报进度；复用一个检测器和最多两个语言对。
- **用户手势**：offscreen 里出现 `NotAllowedError` 时，转成「需要准备」错误，并把待准备的语言对记入 `storage.session`；之后由设置页里的「准备」按钮在用户点击时创建（`features/settings/model/chromeTranslationPreparation.ts`）。
- **缺陷**：网页里直接划词会报错，用户必须先去设置页准备。

## 最值得借鉴的几条

1. 请求代次加 AbortController 双保险、校验来源仍是当前选区、记住关闭过的选区。
2. closed Shadow Root 单例，带所有权代次，只观察宿主的祖先链做有界恢复（我们的灵岛已有类似机制）。
3. 定位用纯函数：上下择优、限高、视口夹取，并避让整个选区。
4. 单页应用和 open Shadow Root 通过 MAIN world 桥接，只在路由真正变化时派发事件（需要评估侵入风险）。
5. 内置 Translator 放在 offscreen，用「待准备语言对」加设置页点击来完成下载。
6. 处理快捷键时，用 `event.key` 优先、遇到 Option 回退 `event.code` 的归一化。

## 我们的差异化（FluentRead 没做到的）

- 划词结果**流式输出**（scheduler `onDelta`，Port delta 帧）。
- 使用 `chrome.commands` 全局快捷键，页面失焦、焦点在输入框时也能用。
- 划词设最短长度。
- 可以固定卡片。
