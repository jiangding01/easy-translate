# 06 · 弹窗、设置、配置迁移与新手引导

[返回总索引](../README.md)。本文描述旧包 `1.0.109`；新工程当前只有骨架。本文中的“建议”不代表已经实现。

## 1. 模块边界与入口

| 入口 | 旧实现 | 责任 |
| --- | --- | --- |
| `popup.html` | `chunks/popup-C6IAxVei.js` | 当前标签页的翻译开关、语言、服务、显示模式、网站/语言规则、划词与悬停快捷设置 |
| `options.html` | `chunks/options-kLkbiu2d.js` | `general / display / subtitle / expert / termbase / advanced` 六个 hash 路由 |
| `onboarding.html` | `chunks/onboarding-BiW0GTIo.js` | 翻译演示、显示模式、工具栏固定、登录四步引导 |
| 配置仓库 | `background.js` 的 `as/_t/ns/En/Ll/Bl` | 默认值合并、Zod 校验、持久化、缓存、版本迁移、配置监听 |

来源：[manifest](../../evidence/legacy/original/manifest.json)、[设置路由 LF2485–2492](../../evidence/legacy/formatted/chunks/options-kLkbiu2d.js#L2485)、[引导步骤 LF363](../../evidence/legacy/formatted/chunks/onboarding-BiW0GTIo.js#L363)。UI 内使用 React/Ant Design；不能从这个安装包恢复原来的 TS 类型、组件目录或构建配置。

## 2. 配置契约

主键为 `chrome.storage.local.congcong_translate_config`，配置版本 **18**，不同于扩展版本 `1.0.109`。完整静态默认值保存在 [default-config.json](../../evidence/legacy/extracts/platform/default-config.json)，schema 与枚举原表达式保存在 [schemas-and-enums.json](../../evidence/legacy/extracts/platform/schemas-and-enums.json)。`$undefined` 表示 JS `undefined`，`$expression` 表示没有执行的表达式，不是实际配置字段。

| 分组 | 旧默认值/含义 | 约束或注意 |
| --- | --- | --- |
| `textRange` | `minLength=10,minWordCount=2,maxLength=5000` | 长度各 0–5000，词数 0–100 |
| `language` | `sourceCode=auto,targetCode=zh-CN` | 初次 `systemCode` 尝试读取browser.i18n和navigator语言并归一化，未命中回退 `en`；源码没有对应chrome.i18n分支 |
| `pageTranslation` | enabled；range=`all`；translateFullPage=false；initialTranslateChars=4999 | 初始字符 0–50000；并非默认全页立即翻译 |
| 网站规则 | 自动 `*.tiktok.com,*.instagram.com,*.youtube.com`，禁止为空 | 自动/禁止规则在 popup 中互斥维护 |
| 语言规则 | always=`en,ja`；never=`zh-TW,zh-HK` | 与页面语言检测、目标语言过滤共同作用，见 02 |
| `displaySettings` | `mixed`，短文本阈值 15，短文本保留原文 | 还支持 `bilingual/replace`；19 个样式枚举，见 02 |
| `hoverTranslation` | enabled，`Control`，delay=0 | delay schema 0–5000ms，实际消费见 03 |
| `selectionTranslation` | enabled，`icon`，minLength=2，排除 `zh-CN` | trigger=`direct/icon/dot/ctrl/option/shift` |
| `inputTranslation` | enabled，firstLanguage=`en`，triggerChar=`space` | 输入三连触发，不是一次空格，见 03 |
| `provider` | `google` | schema 有百度/有道不等于实现支持，见 01 |
| `requestQueue` | maxConcurrent=10，requestDelay=0，retryTimes=1，timeout=30000 | 实际是令牌桶，不是严格十并发，见 01 |
| `cache` | enabled，maxSize=100，ttl=7 | 单位和实际淘汰见 01，不按字段名猜测 |
| `floatingBall` | 右侧 top=120；默认隐藏 `accounts.google.com` | 全站隐藏标记为 false |
| `ai` | style=`builtin-general`；contextEnhancement=true | 实际风格选择字段在这里，见 08 |
| `aiTranslate` | disabled，provider=`openai`，model=`gpt-5-mini` | 默认模板和供应商字段见 01 |
| `generalRule['subtitleRule.add']` | dual，源 auto，目标 `zh-Hans` | 字幕配置与网页配置并非同一组，见 05 |
| `shortcuts` | Alt+X；Ctrl+Shift+Z；按键 1 双击 enabled | Chrome commands 与页面自管键盘有两套来源 |

来源：[schema LF2550–2554](../../evidence/legacy/formatted/background.js#L2550)、[默认值 LF2702](../../evidence/legacy/formatted/background.js#L2702)、[系统语言 LF2705–2731](../../evidence/legacy/formatted/background.js#L2705)。schema 的 optional/default 与当前默认配置不同，例如 `translateFullPage` schema default=true，但默认对象为 false，迁移时应明确选择。

## 3. 配置读写链路

```text
getConfig → _t（内存 at）→ 合并 zt 默认值 → xn.safeParse
无缓存 → as → local storage → 合并 → 校验 → 版本迁移 bh → An 写入
updateConfig({updates}) → ns → 深合并，数组整体替换 → 校验 → An → 更新 at
updateConfigValue({path,value}) → En → 构造嵌套补丁 → ns
resetConfigValue({path}) → Ll → 从 zt 取默认值 → En
storage change → Bl → 更新 at → yU / fU 广播 configUpdated
```

关键原逻辑，来源 [background.js LF2763–2766](../../evidence/legacy/formatted/background.js#L2763)，完整仓库摘录见 [config-store.js](../../evidence/legacy/extracts/platform/config-store.js)：

```js
async function ns(e) { const t = await _t(), a = qi({}, t, e, (r, i) => { if (Array.isArray(r) || Array.isArray(i))
    return i; }); Fl.info({ newConfig: a, currentConfig: t, updates: e }, "updateConfig"); const n = xn.safeParse(qi({}, zt, a, (r, i) => { if (Array.isArray(r) || Array.isArray(i))
    return i; })); if (!n.success)
    throw Fl.error({ err: n.error }, "Invalid config update"), new Error("Invalid configuration"); return await An(n.data), at = n.data, n.data; }
```

**多个调用并发读改写没有串行锁**，不能据此保证不丢更新。`as()` 在存储内容存在但校验失败的分支返回默认对象，未必同时修复旧存储；重构应明确损坏数据的处理策略。

广播采用微任务合并，查询所有标签页，排除内部 scheme，再 `Promise.allSettled` 发给页面。options 也有同类广播，因此旧架构存在重复通知来源。[后台 LF8977–8987](../../evidence/legacy/formatted/background.js#L8977)、[options LF2473–2484](../../evidence/legacy/formatted/chunks/options-kLkbiu2d.js#L2473)。

## 4. 版本迁移表

`bh()` 按旧 `version < N` 逐项执行，结束写 version=18。[原代码 LF2778–2894](../../evidence/legacy/formatted/background.js#L2778)。

| 门槛 | 变更 |
| --- | --- |
| <2 | 划词旧 `autoTranslate/showButton` 改为 `trigger`，补长度/排除语言 |
| <3 | `autoTranslateEnglish` 迁到 `languagePatterns.alwaysTranslate`，补输入设置 |
| <4 | 补 displaySettings |
| <5 | 补 translateFullPage=true |
| <6 | showOriginal=false 映射 replace 模式 |
| <7 | general/formal 等风格名映射 builtin-* |
| <8、<10 | 补显示默认值 |
| <9 | range 强制 all；输入 targetLanguage 改 firstLanguage；zh 归一到 zh-CN |
| <11 | 删除显示字号 fontSize |
| <12 | 字体限制为内置四种，非法值回 default |
| <13 | 删除 useCustomFont/customFontFamily |
| <14 | 删除 fontWeight |
| 15 | 未发现单独 <15 分支，不能补造迁移 |
| <16 | 旧字幕百分比或过大的字号回当前默认 |
| <17 | lineBreak 强制 alwaysNewLine |
| <18 | 补 Google 账户域名悬浮球隐藏规则 |

重要边界：初始化先合并再 schema 校验，只有校验成功后才调用旧版本迁移。极旧结构若已不满足当前 schema，迁移可能根本进不去。以上是旧实现的顺序，不是推荐的新迁移方案。

## 5. 弹窗状态与操作

`Gl()` 加载配置、监听配置变化，再读取当前 tab 的 `getPageLanguage`。`Wl()` 同时监听 `translationStateChanged`、请求 `getTranslationState`；点击时等待 `toggleTranslate` 消息返回，再乐观反转并重新读取状态。它不检查返回对象的 `success` 字段；回读失败时无法保证状态已校准。`zl()` 检查 URL、页面限制，并调用后台 `checkActiveTabTranslatable`。[popup LF1371–1425](../../evidence/legacy/formatted/chunks/popup-C6IAxVei.js#L1371)、[LF1492–1538](../../evidence/legacy/formatted/chunks/popup-C6IAxVei.js#L1492)。

- 切换服务或显示模式后，如果当前页面已经启用翻译，发 `revalidateTranslation`。
- `coco_*` 服务选项写入 aiTranslate 的 coco model；`ai_*` 写 provider/model；普通服务关闭 AI 分支。UI 的选项值不能直接当网络供应商名。
- 网站开关加/删 `autoTranslatePatterns/neverTranslatePatterns`，打开其中一项会移除另一项的匹配规则。
- `vr(domain)` 通过“取最后两个标签”生成 `*.example.com`，**没有 Public Suffix List**。例如 `a.example.co.uk` 会扩大到 `*.co.uk`，重构不应照搬。
- 语言开关归一大小写与 `_`/`-`，匹配相同语言或其子标签。
- footer 打开 options、登录页、订阅/文档外链；PDF 仅在线入口，见 04。

## 6. 设置页保存与特殊入口

一般表单使用 `gc()`：配置回填时用 ref 防止回写；变更等待 **500ms**；把临时字段 `translationService` 还原为真实 provider/aiTranslate 字段；深合并、数组替换；调用 `Ga()` 保存并更新 UI。[options LF2106–2157](../../evidence/legacy/formatted/chunks/options-kLkbiu2d.js#L2106)，摘录 [options-autosave.js](../../evidence/legacy/extracts/platform/options-autosave.js)。

这里有两种测试入口，不能概括为同一条路径：

- 一般设置 `Ky()` 的测试回调以 `Hello`、表单中的源/目标语言直接调用 API chunk；分支代码为百度和有道准备了未实现提示，但当前 `Fy()` 只在 `translationService` 以 `ai_` 开头时渲染测试链接，因此普通服务分支不能直接当成当前UI可点击能力。[LF2182–2268](../../evidence/legacy/formatted/chunks/options-kLkbiu2d.js#L2182)。
- 共享AI服务对话框 `Kp()` 的测试先把填写的provider/model/baseURL/key持久化，再以固定 `en → zh-CN` 测试 `Hello`；失败或随后取消对话框未见回滚。这意味着“测试”不是无副作用操作。[DisplayModeSelector LF1423–1451](../../evidence/legacy/formatted/chunks/DisplayModeSelector-aVEBmg_I.js#L1423)。

两者都不是生产DOM翻译链路的全链路测试，也不能用测试成功证明专家/术语、队列和页面渲染正常。

缓存区域通过 `proxy-service.CacheService` 读取 stats，3 秒读取超时，清空使用 cleanupAll 并设置 5 秒界面超时；“导出”导出**主配置 JSON**，不是缓存条目。[LF1982–2008](../../evidence/legacy/formatted/chunks/options-kLkbiu2d.js#L1982)。主配置导出没有找到密钥脱敏步骤。

高级项 `initialTranslateChars`、输入 firstLanguage 等直接调用按路径更新；字幕页 `r0()` 直接调用 `zt(path,value)`。专家/术语使用独立仓库，详见 08。不要假设所有页都走同一份自动保存实现。

## 7. 新手引导

安装事件仅在 reason=install 且没有 `congcong_onboarding_completed` 时打开引导页。[background LF9727](../../evidence/legacy/formatted/background.js#L9727)。

1. activation：演示悬浮球、连续两次 `1`；`Fr()` 等待 800ms 后切状态。演示正文组件 `Et()` 另行调用 Google API，`Promise.allSettled` 收集结果；状态动画完成不代表所有段落翻译成功。规则卡增删会立即写入真实 `pageTranslation.languagePatterns`，写失败时本地 UI 未见回滚。[LF397–401](../../evidence/legacy/formatted/chunks/onboarding-BiW0GTIo.js#L397)。
2. displayMode：选择 replace/bilingual/mixed、短文本策略，串行 Promise 保存对应配置。
3. pin：`chrome.action.getUserSettings().isOnToolbar` 与 onUserSettingsChanged 监听；没有可用 API 时回 false。此步以 pin 状态限制“下一步”，不是自动替用户固定。
4. login：微信登录按钮先设置 completed 再发起授权，即使授权失败该标记也已写；最后一步可不登录而直接完成并跳到 options。账号链路见 07。

引导支持 `?step=N` 指定有效步骤并清除查询串；跳到末步时不会检查前面步骤的门槛。[onboarding LF535–543](../../evidence/legacy/formatted/chunks/onboarding-BiW0GTIo.js#L535)。预览请求未传 AbortSignal；切换目标语言后旧请求完成时检查的是当前 controller，因此存在旧译文覆盖新结果的静态竞态。[LF384–392](../../evidence/legacy/formatted/chunks/onboarding-BiW0GTIo.js#L384)。

目标语言切换同时更新 UI/systemCode 与网页目标语言。[onboarding LF402–430](../../evidence/legacy/formatted/chunks/onboarding-BiW0GTIo.js#L402)、[LF531–547](../../evidence/legacy/formatted/chunks/onboarding-BiW0GTIo.js#L531)。未在本次分析连接 Google 或执行真实登录。

## 8. 重构设计建议与批次

**建议模块**：`config/schema.ts`、`defaults.ts`、`repository.ts`、`migrations.ts`，以及 popup/options/onboarding 独立入口。先在旧 schema 转换前迁移 raw 数据，再校验目标版本；所有写入通过一个配置仓库，广播也只保留一个入口。

不要直接把当前骨架 `Settings` 扩展成所有字段同时上 UI。每批只引入对应功能实际消费的设置，保留旧字段映射表；迁移旧用户数据属于将来另一个明确任务，因为新扩展 ID 不会自动读取旧存储。

| 批次 | 必要实现 | 验收 |
| --- | --- | --- |
| A | 主配置版本、默认值、读写、单一广播 | 首次、合法/损坏/旧版本数据；数组替换；并发更新不丢字段 |
| B | popup 语言、显示、服务、真实页面状态 | 页面刷新/切 tab/worker 重启后状态一致；错误不保留错误的乐观状态 |
| C | 网站/语言规则与设置按模块保存 | 精确域名和公共后缀；规则互斥；保存失败可恢复 |
| D | 已落地功能的高级设置、引导 | 不展示未实现能力；pin API 不可用时有明确可继续路径 |

## 9. 已知与未知

已确认：配置字段、默认值、schema、迁移分支、UI 保存及消息调用均有旧代码证据。推断：异步写入竞态、旧结构先校验后迁移的风险来自静态控制流；需将来做对应回归测试。未知：旧用户历史数据的真实分布、所有浏览器版本下的工具栏 pin API 行为、外部服务当前可用性。
