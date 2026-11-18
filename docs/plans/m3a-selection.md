# M3a 方案：划词翻译

> 状态：**已合并**（PR #12，2026-11-17）。代码审查见附录 B，自动验收见附录 C，真机调整见附录 D–F；用户真机验收通过。
>
> 已拍板（用户确认）：
> - M3 拆成 M3a 划词 → M3d 动态页与站点规则 → M3b 段落级交互 → M3c 指令台与灵岛键盘 → M3e 本地引擎；
> - 入口是选中后出现的琥珀小点（设置可关），另有右键菜单和全局快捷键；
> - 词典态推迟到 M5；朗读用浏览器自带的 `speechSynthesis`；
> - 原型 `SelectionM3a` 已确认，5 处取舍按建议接受（1.3）；
> - 1.4 的全部文案、首屏 7KB 预算、快捷键默认键（Windows/Linux `Alt+Shift+S`，macOS `MacCtrl+Shift+S`）已同意。
>
> 依据：Design artifact https://claude.ai/artifact/GJTgsP7SFHmhP6M2SczwTp 的「M3 划词翻译」页；`docs/reviews/2026-11-16-fluentread-m3-research.md`；`docs/plans/ui-isle-direction.md`；`docs/plans/m2b-lazy-runtime-and-isle.md`（按需加载约束）；HANDOFF 第 3、5 节。

## 1. 目标与完成标准

### 1.1 用户能做什么

1. 选中网页上的外文文字，松开鼠标后，选区末尾出现一个琥珀小点。点击小点，或者指针先离开、再回到小点上停留约 300ms，卡片就从小点长出来。
2. 选中文字后，用右键菜单「翻译选中文字」或快捷键，直接弹出卡片，不经过小点。
3. 卡片顶部是语言方向（例如「英语 → 简体中文」）和引擎按钮，可以「这次用 X 翻译」。中间是译文：AI 引擎**流式输出**，Google 一次性返回；原文默认折叠成一行，可以展开。底部是复制、朗读、固定、关闭。
4. 固定卡片后，它不会因为点外部或选区移出视口而关闭，可以拖动；之后再选中别的文字，直接在这张卡片里重新翻译。
5. 右键菜单另有「翻译此页 / 显示原文」，效果与快捷键 `⌃⇧A` 相同。

### 1.2 硬性规则：选中什么就翻译什么（用户要求）

1. **固定文字**：选区文字在卡片展开的那一刻固定下来，按 4.3 节的提取规则取「用户看到的文字」，只做空白规整（连续空白合并成一个空格、去掉首尾空白），结果记为 `source`。
2. **原样使用**：`source` 原样作为请求内容，原文行也显示它，不扩展、不截取、不替换。测试断言：请求文字 === 原文行文字 === 提取规则的结果。后台的预处理（去零宽字符、trim）不改变可见内容，不算违反。
3. **不借用整页翻译**：后台缓存按「预处理后的完整文本」做键。在段落里选中一个词，只会命中这个词自己的键，不会拿到整段的译文；内容脚本里整页会话的译文记忆，划词也不碰。
4. **每次请求带递增编号**，并记下发出时的 `source`。发新请求前先取消上一个；回包的编号不是当前请求，或 `source` 与卡片当前的原文不一致，一律丢弃。
5. **过长不翻**：选区超过 2000 个字符时，不出现小点；从菜单或快捷键触发时，卡片直接提示选区过长。不截断，因为截断会违反第 2 条。
6. **重试不重复**：后台重试时先发一个重置帧，卡片清空已累积的增量；最终失败时，也清掉已显示的半截译文（4.1 第 4 条）。
7. **译文就是译文**：后台判定为「已是目标语言」或「无需翻译」时，卡片显示对应提示和原文，不会把原文冒充成译文（4.5 第 3 条）。

### 1.3 原型取舍（已接受）

1. 卡片固定后再选中别的文字，直接在这张卡片里重新翻译，不再出现小点。
2. `Esc` 对已固定的卡片也有效，按下就关闭。
3. 只在卡片展开时才发请求，出现小点时不预先请求。选中不等于想翻译；预先请求会把文字发给第三方，还会消耗额度。
4. 提示框放在卡片外侧：底部按钮的提示显示在按钮下方，引擎按钮的提示显示在上方。
5. 小点放在末字的右上方。

### 1.4 新增的用户可见文案

| 位置 | 文案 | 状态 |
| --- | --- | --- |
| 右键菜单（选区） | 翻译选中文字 | 已同意 |
| 右键菜单（页面） | 翻译此页 / 显示原文 | 已同意 |
| 快捷键描述 | 翻译选中文字 | 已同意 |
| 设置页「通用 · 译文」开关 | 划词小点 · 选中外文后在末尾显示翻译小点 | 已同意 |
| 卡片：选区过长 | 选中的文字太长（超过 2000 字），请缩小选区，或用整页翻译。 | 已同意 |
| 卡片：朗读不可用 | 这台设备没有可用的朗读语音 | 已同意 |
| 卡片：复制成功 | 已复制 | 已同意 |
| 卡片按钮提示 | 复制译文 / 朗读原文 / 停止朗读 / 固定卡片 / 取消固定 / 关闭 | 已同意 |
| 卡片顶部 | 「X → Y」，语言名与工具栏面板同一套写法（如「English → 简体中文」，用户确认统一）；源语言不可靠时显示「自动检测 → Y」 | 已同意 |
| 卡片：已是目标语言 | 这段文字已经是 Y，不需要翻译。 | 已同意（审查补充） |
| 卡片：无需翻译 | 这段文字不需要翻译。 | 已同意（审查补充，例如纯数字、代码） |
| 读屏：加载中 | 正在翻译 | 已同意（审查补充） |
| 读屏：完成 | 已翻译 | 已同意（审查补充） |

引擎列表、出错、重试、「这次用 Google 翻译」沿用灵岛和面板的现有文案。

### 1.5 完成标准

1. 1.1 的 5 项功能与原型一致，亮色、暗色网页都能用，亮暗判定方式与灵岛相同（看宿主背景，不看系统主题）。
2. 1.2 的 7 条硬性规则都有测试守住；提取规则另有真机用例（6.2 第 1 条）。
3. 小点只在以下条件全部满足时出现：
   - 规整后至少 2 个字符，且不超过 2000 个字符；
   - 鼠标已松开；
   - 选区不在输入框、`textarea`、可编辑区里，判定方式见 4.3 第 2 条；
   - 选区不在扩展自己的宿主里；
   - 设置「划词小点」开着；
   - 文字不是目标语言（4.4）。
4. 小点在以下情况下消失：选区消失（160ms 宽限）、重新选择、选区移出视口。关闭过的同一个选区，不会被 `selectionchange` 重新弹出。
5. 首屏内容脚本 gzip ≤ 7KB；新按需模块 `selection-runtime.js` ≤ 18KB（原估 16KB；实测 16.87KB，用户同意调到 18KB）；`page-runtime.js` 不变（≤ 26KB）。
6. 只新增 `contextMenus` 一个权限（不触发安装警告），新增一个快捷键。
7. 整页翻译进行中划词时，首字等待不被整页任务拖住（4.1 第 5 条）。真机验收要记录首字时间。

## 2. 不做的事

- 词典态（音标、释义）：推迟到 M5。
- 在线朗读音色、offscreen 播放：先用 `speechSynthesis`，以后按需再加。
- iframe 内的选区：内容脚本只在顶层 frame 运行。只有右键菜单走退化路径（4.6 第 3 条）；iframe 整体留给 M3d。
- 输入框内划词、输入翻译：M4。
- 同时存在多张固定卡片；记住拖动后的位置。
- 修饰键加悬停译段、仅译选区：M3b。
- `resolveJobContext()` 重构：HANDOFF 的前提是「新增第三个调用方」，划词仍然走 `service.translate`，前提不成立，不在 M3a 里做。
- 从灵岛抽出提示框共用：耦合深、共用省不下体积（两个按需模块各打一份），卡片单独写一个简单的提示框。

## 3. 结构

```
网页
 └─ 内容脚本引导（content.ts，常驻，≤ 7KB）
      ├─ 选区观察：pointerup / keyup / selectionchange（防抖），加廉价过滤
      ├─ 配置：首次遇到非空选区时读一次并缓存，之后 watchConfig
      ├─ 消息：selection.open { selectionText?, frameId }（来自后台）
      └─ 按需加载 ───────────────┐
                                 ▼
      selection-runtime.js（按需模块，WAR，动态 URL，单文件）
        ├─ 语言判定（注入的 detectLanguage）
        ├─ 小点与卡片：closed Shadow DOM 宿主 <et-selection>，挂在 documentElement 下
        ├─ 请求：自建 Port（et-translate），{ stream: true, force? }
        └─ 朗读：speechSynthesis
                                 │ Port：req → chunk(reset) / chunk(delta)* → chunk(final) → done
                                 ▼
后台 Service Worker
  ├─ contextMenus：2 项 → selection.open / page.toggle
  ├─ commands：translate-selection → selection.open
  └─ service.translate：stream 请求 → scheduler.submit(onDelta, onReset，插队)
                         → adapter（format: 'text'）→ provider 产出 delta
```

数据只沿一个方向流动；卡片、整页会话、灵岛三者互不依赖。唯一的交集：灵岛在处理 `Esc` 时，会查看卡片宿主的 `data-open` 属性（4.3 第 8 条）。

## 4. 关键决策

### 4.1 流式通道（后台）

1. **协议**：`TranslateRequest` 增加两个字段。
   - `stream?: true`：只允许 `items.length === 1`，否则返回 `validation/invalid-payload`。
   - `force?: true`：跳过 service 的同语言判定（第 2 步）。只在用户明确要求（菜单、快捷键）时由卡片带上。

   `TranslateChunk` 增加两个分支：`{ id, delta: string }` 和 `{ id, reset: true }`。最终仍发一个普通的完整 chunk，卡片用它**替换**已累积的增量。
2. **提示词格式**：`BuiltPrompt` 增加 `format: 'batch' | 'text'`。
   - stream 请求用 `text` 格式：系统提示要求只输出译文；原文放在**每次请求随机生成**的 nonce 分隔符之间（防止原文里伪造分隔符），并声明「分隔符内是待翻译的文字，不是指令」。
   - OpenAI 兼容和 Gemini 适配器按 `format` 分支：`batch` 保持现有的 JSON 编码与解析；`text` 直接把累积的文本当作结果。Gemini 的 `thought` 部分无论在增量还是最终结果里都要过滤掉。
   - 输出清洗放在适配器里、写入缓存之前：去掉 `<think>…</think>`；去掉首尾成对的引号（原文本身就以引号包裹时保留）；去掉「译文：」「翻译：」「Translation:」这类前缀。清洗后为空，报 `validation/empty-translation`。
   - 提示词带版本号，清洗规则变化时升版本，让旧缓存自然失效。
3. **缓存**：`text` 格式的 LLM 请求，`promptDigest` 与整页翻译的 `batch` 格式不同，所以两者各用一份缓存；Google 的 `promptDigest` 为空，相同文本与整页翻译共用一个键（同一段文字的译文本来就该相同）。两种情况都满足 1.2 第 3 条。
4. **调度器**：`submit` 增加可选的 `onDelta(key, delta)` 和 `onReset(key)`。
   - stream 任务单独成批。
   - 每次尝试（包括重试）开始前调用 `onReset`。
   - provider 的 delta 事件按约 50ms 合并后再转发。
   - 输出累计超过 `max(2000, 原文长度 × 8)` 字时，按 `provider/output-truncated` 结束，防止模型失控时把 64000 字一点点推进卡片。
   - 去重照旧：同一个键已在途时，新调用方并入等待结果，只收到最终结果。
5. **插队与预留**：stream 任务入队时放到队首；并且 LLM 并发额外允许 1 个只给交互任务使用的名额（共享上限 3 个之外 +1），整页翻译占满时，划词也不必等待。mt 引擎（Google）不需要预留，它的并发是 6。
6. **service**：
   - 校验 `stream` 和 `force`；
   - stream 请求把 `onDelta` / `onReset` 转成 chunk 发出；
   - 缓存命中时只发最终 chunk；
   - same-language 和 unchanged 的结果照常带 `disposition` 返回，由卡片按 4.5 第 3 条显示。

### 4.2 按需模块与引导层

1. **第二个按需模块** `selection-runtime.js`：WXT unlisted script，WAR 加动态 URL，单文件零 import，模块求值时只注册工厂 `globalThis[Symbol.for('islet-translate.selection-runtime')]`。PR1 的约束全部适用。
2. **加载器通用化**：`loadRuntime({ path, key, getURL, importModule })`，两个模块共用；引导层为每个模块各缓存一个 Promise，失败时清掉。
3. **引导层新增的常驻部分**：
   - 选区观察：`pointerup` 后 100ms、`keyup` 后 50ms，或 `selectionchange` 稳定后，检查一次。鼠标按住期间不出小点；选区超过 2000 字时，直接放弃，不做多余的 `toString()`。
   - 廉价过滤（同步，不加载按需模块）：长度、可编辑区、扩展宿主、目标语言为中日韩时的文字系统预检（4.4 第 1 条）。
   - 设置读取：首次遇到非空选区时读一次配置并缓存，之后 `watchConfig`，不在每次 `pointerup` 时都读 storage。
   - 消息 `selection.open`。
   - `content.ts` 文件头的注释改为：「常驻部分只有选区监听；唤起前不建 Port、不写 DOM」。
4. **注入依赖**：`SelectionRuntimeDeps = { getConfig, watchConfig, listEngines, detectLanguage }`。Port 由按需模块自己创建，与整页会话的 Port 互相独立。
5. **构建检查通用化**：
   - `check-build.mjs` 对 manifest 中**每个** WAR 文件执行 PR1 的全部断言，并在 vm 里执行，确认各自注册了对应的键；WAR 断言改为精确匹配两个条目；权限断言加入 `contextMenus`；`commands` 断言加入 `translate-selection`。
   - `check-size.mjs` 改为按文件设预算：`page-runtime` 26KB、`selection-runtime` 18KB、content 7KB。

### 4.3 选区提取与卡片

1. **提取「用户看到的文字」**：以 `selection.toString()` 为基础（Chrome 里它按渲染结果生成：不含 `display:none` 的内容，`<br>` 会变成换行）。下面几种情况在 Range 内用树遍历自己拼接文字：
   - 选区与「只看译文」模式下被隐藏的原文（整页翻译用 `font-size:0` 隐藏）相交：跳过这些原文文字节点；
   - ruby：跳过 `rt`、`rp`；
   - 读屏专用的隐藏文字（`sr-only` 一类，判定沿用 `dom-rules`）：跳过。

   选区在网页的 shadow DOM 内时，`getRangeAt` 会被重定向到宿主。这时有 `getComposedRanges` 就用它，没有就用 `selection.toString()`，并以 `pointerup` 坐标作为锚点。
2. **可编辑区判定**：`document.activeElement` 是 `input` 或 `textarea`；或者选区起点所在元素的 `isContentEditable` 为真。两者满足其一，就不出现小点。
3. **宿主**：`<et-selection>`，closed shadow，挂在 `documentElement` 下，用内联 `!important`。`SKIP_TAGS` 和会话的 isOwn 判断都认它；`probe.ts` 的 `topmost` 同时排除灵岛和卡片两个宿主，避免两者互相取色、互相避让。卡片每次打开时，把宿主移到 `documentElement` 的最后，保证在灵岛之上。
4. **复用**：`spring.ts`（弹簧）、`probe.ts` 的 `probeTheme`、`tokens-isle.css`（材质）。提示框单独写一个简单版本：显示在按钮外侧、延时出现、带文字淡出，不留空壳。
5. **定位**：纯函数 `src/content/selection/place.ts`。输入选区所有矩形的并集和视口，输出卡片矩形：
   - 优先放在选区下方，间距 8px；放不下放上方；两边都不够，选空间大的一侧并限高；
   - 卡片最高 380px，超出时内部滚动；
   - 水平夹在视口内 8px；
   - 避让整个选区的纵向范围。
6. **生长**：小点和卡片是同一个元素，clip-path 加弹簧。从菜单或快捷键打开时，从选区末尾的点长出来；从 iframe 退化路径打开时，从卡片顶边中点长出来。
7. **小点的悬停展开**：小点出现后，指针必须先离开小点 12px 以外，再回到小点上停留 300ms 才展开。拖选结束时，指针本来就停在末字附近，这条规则防止「没表达意图就把文字发出去」。点击小点则始终立即展开。
8. **关闭**：
   - 未固定时：点卡片外部（`composedPath` 判断）、按 `Esc`、选区移出视口时，卡片收回成小点再消失。不再「一滚动就关」，自动滚动的页面上卡片也能用。
   - 已固定时：只有 `Esc` 和关闭按钮能关闭。
   - 卡片可见时，宿主带 `data-open`；灵岛收到 `Esc` 时，先检查这个属性，存在就不处理。一次 `Esc` 只关闭最上面那一层。
   - 关闭时记下这个选区（文字，加首尾的边界节点和偏移），之后同一个选区不再弹出。
9. **固定与拖动**：固定后，拖动顶部空白处可以移动卡片（pointer capture 加 rAF 合帧）；取消固定后，回到跟随选区的定位。
10. **不打扰**：
    - 小点和卡片的按钮都设 `tabindex=-1`；在 `pointerdown` 和 `mousedown` 上都 `preventDefault`，不清掉网页的选区，也不抢焦点；忽略不可信事件。
    - 读屏：加载开始时播报「正在翻译」，完成时播报「已翻译」，各一次。

### 4.4 语言判定

1. **廉价预检**（引导层，同步），只拦明显不需要翻译的情况，不做简繁之分：
   - 目标是中文（简体或繁体）：选区不含假名和韩文字母，而且全部由汉字和中文标点组成时，交给第 2 步检测，不在这里直接放行；
   - 目标是日语：选区不含假名时，不在这里拦（交给第 2 步）；含假名且不含韩文字母时，不出现小点；
   - 目标是韩语：选区由韩文字母为主时，不出现小点；
   - 其他目标语言：不做预检。
2. **检测**（按需模块，异步）：调用 `i18n.detectLanguage`。结果可靠、占比最高的语言 ≥ 80%，并且等于目标语言时，不出现小点。
   - 简繁按 `normalizeLanguage` 区分，与后台规则一致。
   - 判定规则从后台的 `createSameLanguageCheck` 抽成纯函数，放到 `src/lib/languages.ts`，前后台共用。
   - 少于 10 个字时，检测结果不可靠，按「不是目标语言」处理，出现小点。
3. **菜单和快捷键触发时**，不做判定，请求带 `force: true`，后台跳过同语言检测（用户明确要求了）。
4. **卡片顶部的源语言名称**：用检测结果；检测不可靠时，显示「自动检测」。请求的 `source` 始终传 `auto`。

### 4.5 引擎、结果与朗读

1. **引擎**：默认用配置里的引擎；「这次用 X 翻译」只影响这张卡片之后的请求，不改配置。引擎列表经注入的 `listEngines` 获取（白名单字段）。
2. **出错**：
   - 一般错误：用 `describeError` 显示原因，提供「重试」；当前引擎不是 Google 时，再提供「这次用 Google 翻译」。
   - `network/port-disconnected`（Service Worker 空闲后重启）：自动重连并重试 1 次；仍失败才显示错误。
   - `internal/context-invalidated`（扩展已更新）：显示「无法连接页面，请刷新网页后重试」（`network/page-unreachable`）。
3. **`disposition` 的显示**：
   - `translated`：显示译文；
   - `same-language`：显示「这段文字已经是 Y，不需要翻译。」和原文（只有小点路径会遇到，因为菜单和快捷键带了 `force`）；
   - `unchanged`：显示「这段文字不需要翻译。」和原文。
4. **朗读**：
   - 用 `speechSynthesis` 朗读**原文**；`lang` 设为检测到的源语言，检测不可靠时不设。
   - `getVoices()` 为空时，等 `voiceschanged`，最多 1 秒，仍为空才判定为不可用：按钮置灰，提示「这台设备没有可用的朗读语音」。
   - 只在**自己的**朗读正在进行时才调用 `cancel()`，不打断网页自己的朗读。卡片关闭、换选区、卸载时，都按这个规则停止。
5. **复制**：
   - 优先用 `navigator.clipboard.writeText`；失败时，在 shadow 内用临时 `textarea` 加 `execCommand('copy')` 兜底：先保存网页的选区和焦点，复制后恢复；这段时间内触发的 `selectionchange` 一律忽略。
   - 成功后提示「已复制」。

### 4.6 右键菜单与快捷键

1. **右键菜单**：
   - 后台在 `runtime.onInstalled` 时 `removeAll`，再串行重建两项：`translate-selection`（上下文 `selection`，「翻译选中文字」）和 `translate-page`（上下文 `page`，「翻译此页 / 显示原文」）。两项都设 `documentUrlPatterns: ['http://*/*', 'https://*/*']`。
   - `contextMenus.onClicked` 在后台**顶层同步注册**，保证 Service Worker 重启后仍然生效。
   - 点击选区项，向该标签页的 frameId 0 发 `selection.open { selectionText, frameId: info.frameId }`；点击页面项，发现有的 `page.toggle`。
2. **快捷键**：新增 command `translate-selection`。
   - 默认键：Windows/Linux `Alt+Shift+S`，macOS `MacCtrl+Shift+S`。不用 `Alt+S`：它与 Outlook 网页版的「发送」、MediaWiki 在 Chrome 中的保存访问键冲突；也不用 Option 组合（HANDOFF 的决策）。
   - 真机验收要核对这两个键在 Chrome 和常见网站（GitHub、Google Docs、Notion、Outlook、维基百科）上是否冲突。一旦冲突，合并前改掉，并在本文记录结论。
   - 按下时：有选区，就翻译这个选区（卡片已开着也一样，换成新选区）；没有选区但卡片开着，就关闭卡片（固定的也关）；两者都没有，什么也不做。
3. **`selection.open` 在内容脚本里的处理**：
   - `frameId` 不是 0（选区在 iframe 里）：只用 `selectionText` 作为 `source`，卡片显示在视口上方三分之一处、水平居中，不出现小点。
   - `frameId` 是 0 且顶层有非空选区：用 4.3 第 1 条的规则提取，并核对规整后的结果与 `selectionText` 一致；不一致时，以 `selectionText` 为准，卡片用 iframe 退化路径的位置显示。
   - 来自快捷键的消息（没有 `selectionText`）：先检查 `document.hasFocus()`，焦点不在顶层文档时不处理。
   - 以上情况都带 `force`，跳过语言判定（4.4 第 3 条）。

### 4.7 配置

新增 `selection: { showDot: boolean }`，默认 `true`。在 `types.ts`、`defaults.ts`、`schema.ts`、`client.ts` 的 `normalizeConfig` 各加一处，不提升 `schemaVersion`；`paths.test.ts` 的精确路径列表加上 `selection.showDot`。设置页「通用 · 译文」新增开关「划词小点」，通过 `watchConfig` 立即生效。

## 5. 文件改动清单（约 38 个文件，超过 8 个；分三段实施，合成一个 PR）

| 段 | 文件 | 改动 |
| --- | --- | --- |
| A 后台流式 | `src/lib/messaging/protocol.ts` | `stream`、`force`、delta 和 reset chunk；`selection.open` 消息 |
| A | `src/lib/translate/types.ts`、`prompt.ts` / `.test.ts`、`codec.ts` | `format`、单段纯文本提示词、nonce 分隔、清洗与版本号 |
| A | `src/lib/translate/providers/openai-compat.ts`、`gemini.ts` 和测试 | 按 `format` 分支；产出 delta；过滤 thought；清洗 |
| A | `src/lib/translate/scheduler.ts` / `.test.ts` | `onDelta`、`onReset`、50ms 合并、输出上限、插队、交互预留名额 |
| A | `src/lib/translate/service.ts` / `.test.ts` | `stream` / `force` 校验与透传 |
| A | `src/content/session.ts` | 收到新 chunk 分支时加类型守卫（整页会话忽略 delta 和 reset） |
| B 接线 | `wxt.config.ts` | `contextMenus`、第二个 WAR、`translate-selection` 命令 |
| B | `src/entrypoints/background.ts`，新增 `src/lib/context-menu.ts` / `.test.ts` | 菜单（顶层注册、串行重建）、命令 |
| B | `src/content/loader.ts` / `.test.ts`、`bootstrap.ts` / `.test.ts`、`runtime-contract.ts`、`src/entrypoints/content.ts` | 通用加载器、`selection.open`、注释 |
| B | 新增 `src/content/selection/watch.ts` / `.test.ts` | 选区观察与廉价过滤（引导层） |
| B | `src/lib/languages.ts` / `.test.ts`、`src/lib/translate/language.ts` | 抽出语言判定纯函数 |
| B | `src/lib/config/types.ts`、`defaults.ts`、`schema.ts`、`client.ts`、`test-fixtures.ts`、`parse.test.ts`、`client.test.ts`、`paths.test.ts` | `selection.showDot` |
| B | `src/entrypoints/options/GeneralPage.tsx` | 「划词小点」开关 |
| B | `src/content/dom-rules.ts`、`session.ts`、`src/content/isle/probe.ts`、`isle.ts` | 认 `ET-SELECTION`；`topmost` 排除两个宿主；灵岛的 `Esc` 先看卡片是否打开 |
| B | `scripts/check-build.mjs`、`check-size.mjs` | 多个按需模块、权限、命令、预算 |
| C 卡片 | 新增 `src/entrypoints/selection-runtime.ts` | 注册工厂 |
| C | 新增 `src/content/selection/{extract,place,card,request,speech,styles}.ts` 和测试 | 提取、定位、卡片 DOM 与状态机、请求与丢弃规则、朗读、样式 |
| 文档 | `CHANGELOG`、`HANDOFF`、`README`、本文 | 同步 |

三段依次由子代理实现：A → B → C。每段 `npm run check` 全绿后再进下一段。B 依赖 A 的协议，C 依赖 A 和 B，所以不拆成多个 PR。

**注意**：每段的 `npm run check` 都会重写 `.output/chrome-mv3`。用户在 Chrome 里加载着这个目录时，开发期间可能看到 “An unknown error occurred when fetching the script”，在扩展管理页刷新即可。自动验收一律复制产物到临时目录再加载。

## 6. 验证

### 6.1 单元测试（重点）

- **1.2 硬性规则**：
  - 请求文字 === 原文行 === 提取结果；
  - 在已翻译的段落里选中一个词，后台按这个词的键查缓存和请求；
  - 迟到的回包按编号和 `source` 丢弃；发新请求时取消旧请求；
  - 超过 2000 字不发请求；
  - 重试后不重复（reset），最终失败时清掉半截译文；
  - `same-language` 和 `unchanged` 不会被当作译文显示；
  - 带 `force` 时，后台不判同语言。
- **流式**：
  - provider 按 `format` 分支、产出 delta、过滤 thought；
  - 清洗规则；
  - scheduler 的转发、50ms 合并、输出上限、插队、交互预留名额；
  - 缓存命中和 Google 都不发 delta；
  - 同键去重时，并入的调用方只收到最终结果；
  - stream 请求带多条时报错。
- **提取**：只看译文模式、ruby、读屏隐藏文字、`<br>`，以及 shadow DOM 的退化路径（happy-dom 能覆盖的部分）。
- **选区观察**：防抖、鼠标按住时不出、廉价过滤各条件、可编辑区判定、扩展宿主内不触发、关闭过的选区不重弹、设置关掉后不出、160ms 宽限。
- **定位** `place`：放下方、放上方、两边都不够时限高、水平夹取、避让整个选区。
- **卡片**：
  - 状态：加载、流式、完成、出错、过长、已是目标语言、无需翻译；
  - 交互：悬停展开要先离开再进入、固定、拖动、取消固定、`Esc` 的分层、外部点击、选区移出视口时关闭、固定后换选区直接重译、换引擎；
  - 朗读：`voiceschanged`、只取消自己的朗读、卸载时停止；
  - 复制兜底：恢复选区和焦点，忽略期间的 `selectionchange`；
  - 端口错误：断开时自动重试一次，上下文失效时提示刷新页面。
- **菜单与快捷键**：串行重建、顶层注册、`documentUrlPatterns`、点击后发出的消息、快捷键三种分支、iframe 的 `frameId` 路径、`hasFocus` 判断。
- **构建检查**：两个按需模块各自的断言；让其中一个不注册时，`check:build` 必须失败（反向验证）。

### 6.2 真机验收

先用 Chrome for Testing 跑一遍能自动化的部分（产物复制到临时目录，不碰 `.output`），再由用户在 Chrome 里确认：

1. 在一句话里分别单选一个词、选半句、选整句，译文都与所选内容一一对应；只看译文模式下选中译文、带 ruby 的日文、带 `<br>` 的段落，原文行都等于所见文字。
2. 目标为简体中文时：选中中文不出现小点；选中繁体中文或纯汉字的日文，按检测结果处理；选中 1 个字符、在输入框里选中，都不出现小点。
3. DeepSeek 或 OpenAI 下能看到流式输出，Google 一次性返回；整页翻译进行中划词，记录首字等待时间。
4. 右键菜单两项都可用；快捷键在 Chrome 和 GitHub、Google Docs、Notion、Outlook、维基百科上不冲突（记录结论）。
5. 固定、拖动、`Esc`（卡片和灵岛同时存在时）、外部点击、选区移出视口时的行为，与原型一致；亮色、暗色网页各看一次。
6. 朗读能读出原文，关闭卡片后停止。
7. 在严格 CSP 站点（github.com）上，卡片正常显示和翻译。
8. 网页按扩展 ID 取不到 `selection-runtime.js`；网页收不到任何带扩展 ID 的消息。

## 7. 风险与回滚

- **最脆弱的假设**：单段纯文本提示词的输出足够干净，4.1 第 2 条的清洗能兜住常见的「加料」（引号、前缀、思考过程）。如果某个模型仍然经常输出多余内容，就针对它补充清洗规则并升提示词版本；增量照常显示，最终译文以清洗后的为准。
- **交互预留名额**：LLM 的总并发会从 3 升到最多 4，可能更快触发服务商限流。现有的 429 冷却机制仍然有效。
- **体积**：首屏预算上调 1KB（已同意）。超出时先查是什么占了体积，不默默放宽。
- **回滚**：revert 即可。`selection.showDot` 是带默认值的追加字段；撤掉 `contextMenus` 后，菜单自然消失。缓存里多出的 `text` 格式条目，会按现有 TTL 淘汰。

## 附录 A：方案审查记录（2026-11-16，Opus 对抗式审查）

共有阻断 3 项、应修 12 项、建议 11 项，全部吸收进正文。主会话抽查了 `service.ts` 的同语言跳过、适配器固定的 JSON 编码，以及 scheduler 的整批重试，确认属实。

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| 阻断 | 重试会重复发出增量，失败后残留半截译文 | 增加 reset 帧（1.2 第 6 条、4.1 第 4 条） |
| 阻断 | 从菜单或快捷键翻译目标语言文字时，会被后台判为同语言，把原文当成译文显示 | 增加 `force`；卡片按 disposition 分别显示（1.2 第 7 条、4.5 第 3 条） |
| 阻断 | 在 iframe 里右键时，会误用顶层残留的选区 | 消息带 `frameId`，并核对顶层选区与 `selectionText` 是否一致（4.6 第 3 条） |
| 应修 | 适配器固定 JSON 编码，纯文本输出会被判为 bad-response | 增加 `BuiltPrompt.format` 分支（4.1 第 2 条） |
| 应修 | 整页翻译进行中时，划词要排队等名额 | 插队，并预留 1 个交互名额（4.1 第 5 条） |
| 应修 | 换选区时不取消上一个请求 | 发新请求前先取消（1.2 第 4 条） |
| 应修 | Port 断开时的错误文案映射有误 | 区分断开重连和上下文失效（4.5 第 2 条） |
| 应修 | 小点出现在指针下方，停留就会自动展开 | 要求指针先离开再进入（4.3 第 7 条） |
| 应修 | 只在 pointerdown 上 `preventDefault`，可能清掉选区 | 同时拦截 mousedown（4.3 第 10 条） |
| 应修 | 只看译文模式下，被隐藏的原文会混进选区文字 | 增加提取规则和真机用例（4.3 第 1 条） |
| 应修 | 中日韩预检会误杀繁体和日文 | 重写预检规则（4.4 第 1 条） |
| 应修 | 引导层每次 pointerup 都读一次 storage，常驻代价没写明 | 首次读取后缓存并 watch；更新注释（4.2 第 3 条） |
| 应修 | 输入框判定看 anchorNode 不可靠 | 改看 `activeElement` 和 `isContentEditable`（4.3 第 2 条） |
| 应修 | 朗读：语音列表异步加载；`cancel` 会全局打断 | 等 `voiceschanged`；只取消自己的朗读（4.5 第 4 条） |
| 应修 | 文件清单有遗漏 | 补上 `session.ts`、`paths.test.ts`、`probe.ts` |
| 建议 | 不抽 tooltip；不做 `resolveJobContext`；缓存描述有误；nonce 分隔与清洗；增量合并与输出上限；选区观察的细节；复制兜底的副作用；菜单顶层注册与 `Alt+S` 冲突；层级与 `Esc` 分层；补文案；`.output` 被重写 | 全部吸收 |

## 附录 B：代码审查记录（2026-11-17，check Deep）

两位 Opus 审查者按领域分工并行审查：一位负责后台流式与接线，一位负责选区与卡片；每位都从安全、架构、对抗式三个角度看。主会话核对了中等级别问题所引用的代码。修复分给两个子代理并行完成，每条都写了在旧代码上会失败、修复后通过的回归测试。

| 级别 | 侧 | 问题 | 处理 |
| --- | --- | --- | --- |
| 中 | 内容 | 提取结果为空时，菜单和快捷键退回原始文字，小点路径却不出小点，同一选区两条路径结论相反（例如只选中注音） | 抽出唯一的 `sourceOf`，所有路径共用 |
| 中 | 内容 | 树遍历比 `toString` 多收文字：`visibility:hidden` 的提示框文字、表单控件的默认文本 | 遍历跳过这两类，结果只会比 `toString` 少 |
| 中 | 内容 | open shadow 里的可编辑区没有识别出来，编辑器里会出小点 | 逐层取最深的焦点元素，并用组合选区的起点判断 |
| 中 | 内容 | 网页脚本反复修改选区时，固定卡片会在没有用户手势的情况下就地重译 | 只有 1 秒内发生过可信的 pointerup 或 keyup 才重译 |
| 低 | 内容 | 小点换位置后，旧的悬停计时器没清；一次 Esc 同时关掉小点和灵岛；在卡片自身里选中文字，会把卡片内容再翻译一遍；扩展更新后旧页面反复尝试加载；朗读 `cancel` 清空了网页的朗读队列；一条测试是空心的 | 逐条修复；朗读的取舍写在文件注释里 |
| 低 | 后台 | 清洗规则会误删原文本来就带的标签前缀（任何语言），以及成对标点包裹的引号 | 原文自带时保留 |
| 低 | 后台 | Google 划词请求并入还在排队的整页任务后，失去插队 | 把排队中的任务提到队首，并允许它使用预留名额 |
| 低 | 后台 | 输出上限的边界没有测试钉住；「batch 提示词不变」的测试是空心的；重试等待期间取消、Google 流式路径没有测试 | 补测试并做变异验证；batch 提示词摘要写死为固定值 |

可以接受的取舍（审查者判断，主会话同意）：
- 网页用 `opacity:0`、透明文字、`font-size:0` 等方式藏起来的文字，仍然会被翻译。这些是网页自己的文字，展开原文行就能看到；要准确识别必须做布局判定，代价高、误判多。
- 右键菜单的 `documentUrlPatterns` 只匹配 http 和 https，`about:blank` 或 srcdoc 类型的 iframe 里可能不显示菜单。

已知残留（低）：
- 任何可信的 keyup 都算一次手势，范围偏宽；
- 网页先用脚本选中 X、用户再亲手选同一个 X 时，选区观察会当成同一选区不再上报；
- 网页在我们之后还排着朗读时，点「停止」后我们这条仍会读完，只是界面立即显示已停止。

验证：`npm run check` 全绿，共 924 个测试；首屏 6.96KB / 7KB（余量很小），`selection-runtime` 17.04KB / 18KB，`page-runtime` 23.24KB / 26KB。

## 附录 C：修复后自动验收（2026-11-17）

环境：Chrome for Testing 158、CDP 驱动，用真实的 Google 引擎；只加载产物副本，交互用可信的 `Input` 事件。全程页面和 SW 的异常、console error 均为 0。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 单词、半句、整句 | 通过 | map → 地图；A paper map never tells you → 纸质地图永远不会告诉你；整句 → 纸质地图永远不会告诉你要去哪里。三种情况下原文行都等于选区 |
| 右键菜单、暗色、断网、固定后拖动、靠近底部翻到上方 | 通过 | 与 6.2 节一致 |
| 隐藏文字 | 通过 | 网页选区的 `toString` 含读屏文字，但原文行是 "Read the docs now."，不含 SECRET 和 (new tab) |
| shadow DOM 里的可编辑区 | 通过 | 在 shadow 里的 contenteditable 中选中文字，不出现小点；对照组的普通段落照常出现 |
| 卡片固定后，网页脚本改选区 | 通过 | 每 200ms 执行一次 `selectAllChildren`，持续 3.2 秒，期间请求数 0 → 0；用真实鼠标选中后，卡片就地重译，请求 +1 |
| ruby 读音 | 通过 | 只选中 rt「かん」时，小点路径和菜单路径的原文行一致 |
| Esc 分层 | 通过 | 第 1 次 Esc 只关闭小点，第 2 次才收起灵岛 |

本轮没有覆盖，留给用户真机验收：朗读、快捷键冲突、github.com 的严格 CSP、LLM 流式输出。

## 附录 D：真机验收后的调整（2026-11-17）

用户在 Chrome 中真机验收：整体功能正常，GitHub（严格 CSP）可用，朗读可用。反馈的问题与处理如下：

| 反馈 | 处理 |
| --- | --- |
| 小点展开成卡片时位置突变（卡片按整个选区定位，离小点很远） | 卡片水平方向以小点为锚：小点在右半边时右缘对齐，在左半边时左缘对齐，卡片从小点所在的角长出来 |
| 选区滚出视口再滚回来，小点不再出现 | 滚出视口时改为「停放」，不记为已关闭；滚回时重新显示小点。只有 Esc、点外部、点关闭按钮才算主动关闭 |
| 卡片会盖住灵岛 | 灵岛在外形静止后，把矩形写到宿主的 `data-et-rect` 属性，卡片定位时避开它（留 8px） |
| 朗读的声音不好听 | 用户选方案 A：优先系统高质量本地语音（Enhanced、Premium、Siri、Neural），其次 Chrome 的在线 Google 语音（会把原文发给 Google，已写在代码注释里），再其次其他本地语音 |
| DeepSeek 不像流式、比 Google 慢 | 用本地慢速假服务在 Chrome for Testing 里验证：卡片确实逐字流式显示，服务端增量到卡片显示约 43ms，各环都没有丢失增量。体感上的「一次性出现」来自模型的首字延迟加上生成过快；顺带让划词请求免掉 LLM 约 200ms 的启动间隔 |
| 鼠标停在小点上有时不展开（小点出现在指针正下方，「先离开再进入」规则让人以为失灵） | 小点离松手位置至少 20px；规则改为「从外面进入感应区并停留 300ms 就展开」；小点出现时指针已经在区内的，要先出去再进来 |
| 右键翻译的结果与整页翻译不一致 | 符合预期：两者的提示词格式和缓存不同；用 Google 时两边共用缓存，结果一致 |

修复中顺带发现并修复：选区滚回视口时，Chrome 会对静止的鼠标补发一次 pointerenter，加上用的是过期的松手坐标，小点会自己展开。

验证：`npm run check` 全绿，共 955 个测试；首屏 6.97KB / 7KB，`selection-runtime` 17.96KB / 18KB（两者余量都很小，之后的改动要先评估体积预算），`page-runtime` 23.30KB / 26KB。

## 附录 E：增量审查与体积方案（2026-11-17）

**增量审查**（Opus）针对附录 D 的改动，发现中等 2 项、低等 4 项、测试缺口 2 处，已全部修复，并补了先红后绿的测试：
- 停放后选中的新文字被拒绝时（目标语言、过长过短、命中已关闭），会出现「幽灵小点」。现在这三个分支都会结束停放；扩展上下文失效时，隐藏已加载运行时的小点。
- 滚动把小点带到静止的指针下面时会自动展开。现在 `follow()` 移动后，小点盖住指针就要求先出去再进来。
- 卡片避让灵岛时没有判断是否真的重叠。现在只在另一轴的投影重叠时才避让。
- 灵岛的 `data-et-rect` 过期。现在卡片打开期间用 MutationObserver 跟踪；选取灵岛宿主改用 `:scope > et-isle`。
- `nudgeDot` 靠近视口边缘时挪不开。现在增加了右、左、上三个备选方向，并修正了注释。
- 选中的在线语音在断网时不出声。现在会用本地语音重试一次；本地语音按 `default` 优先。

**体积方案**：Sonnet 实测各部分构成，由 Fable 5.2 裁决、用户批准，选择「错误文案改由后台提供」。
- `AppError` 新增可选字段 `userMessage`。后台在 Port 出口（error 帧和分条错误都包括）按错误码，从静态文案表里填写；内容侧显示 `userMessage ?? 本地两条兜底 ?? 通用句`。设置页和面板仍然使用完整表。
- 构建检查新增一条：三个内容产物里不得出现完整文案表的特征串，已做反向验证。
- 精简 token 文件只能省约 78 字节，暂不做。
- 预算：`page-runtime` 从 26KB 收紧到 24KB；其余不变。

**实测**：`npm run check` 共 993 个测试全部通过（`cache.test.ts` 那条已知的时序用例偶发失败一次，单独重跑通过）。体积 gzip：content 6.99 / 7KB（**只剩约 10 字节余量，下次改引导层前必须先处理**）；page-runtime 21.86 / 24KB；selection-runtime 17.14 / 18KB；background 48.54 / 60KB。

## 附录 F：真机反馈修复（2026-11-17，已验收通过）

| 反馈 | 处理 |
| --- | --- |
| Google 偶发返回 200 但部分句子原样回显，写进 7 天缓存后每次复现 | 新增 `src/lib/translate/echo.ts` 的 `isEchoedTranslation`：去掉内联标签和零宽字符、按句切分；候选句需至少 4 个拉丁词、20 个拉丁字母、2 个全小写词，且不含代码字符；目标语言为 en，或已知源语言与目标同基码时不判。`scheduler.ts` 的 `complete()` 对回显条目照常返回但不写缓存（对所有引擎）。`providers/google.ts` 新增 `retryEchoed`：对回显条目用 `/translate_a/single` 重试一次，更好就替换；失败（429 或拦截页）保留原结果并停止后续重试。补了 echo、google、scheduler 的回归测试 |
| 卡片水平定位 | 优先向右展开：左上角对齐小点向右长；视口放不下或被侧边灵岛挡住，再右上角对齐向左长；两边都不行沿用旧的左右半边加夹紧兜底。翻到上方同样适用（`src/content/selection/place.ts`） |
| 卡片滚动条 | 透明轨道，次要文字色 40% 的细滑块（`scrollbar-color`），作用于正文 `.bd` 与引擎列表 `.op` |

**验收**：清缓存后 GitHub LoopForge FAQ 两段完整译出；6.2 节第 3 项（错误文案：DeepSeek 错误密钥显示「密钥无效或没有访问权限。请检查密钥后重试。」，并提供「重试」「这次先用 Google 翻译」）和第 8 项（DeepSeek 流式可见）通过。

**体积（gzip）**：content 6.99KB / 7KB、page-runtime 21.86KB / 24KB、selection-runtime 17.06KB / 18KB、background 49.08KB / 60KB、popup 79.59KB / 90KB、options 86.21KB / 150KB。

**不做**：卡片「重试」不绕过缓存（只在出错时出现）；「翻译服务返回了空结果」未能复现，根因未知，再遇到需抓现场。
