# 09 · 浏览器平台能力、反馈、遥测与生命周期

[返回总索引](../README.md) · [架构与协议](00-architecture.md)

## 1. 后台启动顺序

`Dq.main()` 的调用顺序为 `Rq()`（commands、TikTok 原生消息、安装引导、action click），`AU()`（通用消息），`RS()`（遥测），`Oq()`（缓存/字幕服务、右键菜单、tab 状态），最后 `await yU()`（配置初始化、配置广播监听、队列初始化、冲突扩展检查、快捷键同步）。多个初始化段单独 catch，失败可能被吞掉后继续启动。[background LF9728–9749](../../evidence/legacy/formatted/background.js#L9728)。

没有证据表明这些内存缓存和状态在 MV3 Service Worker 停止后仍保存。重构需要依赖持久化恢复，并在每次 worker 冷启动幂等注册监听。

## 2. 右键、快捷键与 badge

| 能力 | 旧入口和消息 | 实现细节 |
| --- | --- | --- |
| 右键划词 | menu `translate-selection`→`translateSelection` | contexts=selection，不直接使用 menu 的 selectionText，交给页面读取 |
| 右键页面翻译 | `toggle-page-translation`→`toggleTranslate` | 排除内部页和受限 URL；标题按 UI 语言生成 |
| Chrome 快捷键 | commands.onCommand | Alt+X 切页面，Ctrl/Command+Shift+Z 截图；当前 active tab 派发 |
| 页面双击键等 | host 自己的 keydown | 与 commands 独立，具体见 03 |
| 翻译 badge | `go(tabId,enabled)` | enabled 时文字 ✅；tab 状态与切换驱动更新 |

菜单创建用 Promise 链串行化，先删旧 ID 再创建；在后台加载、onInstalled、onStartup 都注册。`vw()` 用 commands.getAll 同步用户在 Chrome 快捷键页配置的值回主配置。[background LF8987–9000](../../evidence/legacy/formatted/background.js#L8987)、[LF9629–9720](../../evidence/legacy/formatted/background.js#L9629)。

后台 `kU()` 可翻译性检查：没有 tab/url 返回不可翻译；向页面发原生 `{type:'ping'}`，**即使 ping 抛错仍返回 canTranslate=true**。这个返回值只说明后台允许尝试，不证明 content script 存在。popup 另有 URL 检查，见 06。

manifest 同时声明 default_popup 和 action.onClicked 监听。通常用户点击会打开 popup，不能把 fallback 的“新窗口打开设置页”监听当作主入口已经触发。

## 3. 平台消息及权限归属

完整名称表：[runtime-message-names.json](../../evidence/legacy/extracts/platform/runtime-message-names.json)。以下契约均来自 AU 的 handler，不是新 API。

| 消息 | 请求 | 响应/用途 | 旧权限 |
| --- | --- | --- | --- |
| `openUrl` | `{url}` | HTTP(S) 原址，否则 runtime.getURL；tabs.create | 旧包声明tabs；此处不推导最小权限要求 |
| `backgroundFetch` | `{url,method,headers:[key,value][],body,credentials}` | `{status,statusText,body}`；网络错返回 status=0 | 全站 host_permissions |
| `captureVisibleTab` | 无，sender.tab.windowId | PNG data URL | activeTab/host 权限 |
| `downloadImage` | `{dataUrl,filename,saveAs?}` | `{success,downloadId? ,error?}`，默认saveAs=true | downloads |
| `ttsSpeak` | `{items:[{text,lang?}]}` | `{success,error?}`，逐项排队 | tts |
| `ttsStop` | 无 | `{success,error?}` | tts |
| `getConflictExtensionState` | 无 | `{exists,enabled,name?,isManaging}` | management |
| `disableConflictExtension` | 无 | `{success,error?}` | management |
| `getFeedbackData` | `{description}` | 收集配置/用户/页面/版本的 payload | storage、tabs |

来源：[background LF9000–9085](../../evidence/legacy/formatted/background.js#L9000)。权限列是旧包声明与功能的关联，不是各API最小权限清单。本次没有调用真实外部服务，也没有操作用户已安装的其他扩展。

`backgroundFetch` 把 GET/HEAD 的 body 去掉，默认 credentials=omit，通过 ai() 处理请求头，再把响应读为 text。旧 handler 本身未发现调用方 origin 或 URL allowlist 校验，不能把它直接作为新扩展的无限制网络代理；新设计应由各业务接口声明允许的请求范围。

## 4. TTS 逻辑

`ww()` 查 chrome.tts 或 browser.tts；`TU()` 修剪并过滤空文本，先 stop，再按 items 顺序调用 `_U()`，第一项 enqueue=false，后续 true。`_U()` 同时兼容回调与 Promise，通过一次完成标记避免重复 resolve；回调读取 runtime.lastError。

```js
for (let n = 0; n < a.length; n++) {
    const r = a[n];
    await _U(t, r.text, { lang: r.lang, enqueue: n > 0 });
}
```

原代码 [LF9042–9045](../../evidence/legacy/formatted/background.js#L9042)，摘录 [tts-handler.js](../../evidence/legacy/extracts/platform/tts-handler.js)。这是把文本交给浏览器语音引擎排队，不保证语言 voice 已安装，也不等同于“每段播完才继续”的回调契约。页面端按钮使用见 03/05a。

## 5. 冲突扩展管理

旧包固定了一个扩展 ID `Cn`。`checkExtensionExists()` 用 management.getAll 过滤 extension；手动 disable 方法保存 `{originallyEnabled,...}` 到 `extension_state_<id>`，写 conflict_management_active，并 setEnabled(false)。restore 方法在存储标记存在时恢复 originallyEnabled，再清理状态。[background LF2898–2955](../../evidence/legacy/formatted/background.js#L2898)。

关键差异：启动调用的 `checkAndDisableConflictingExtension()` 只是读取状态，表达式 `return !t || !t.enabled, !0` 最终返回 true，**没有调用禁用方法**。方法名不代表自动禁用了其他插件。restore 虽有实现，本次入口追踪未找到明确的退出/卸载调用，不能声称卸载必定恢复。

实际手动路径也不能仅以返回值判断成功：`disableExtension()/enableExtension()` 内部吞掉 `management.setEnabled` 的异常，上层仍可能写管理标记或清除原状态并返回成功。因此 `{success:true}` 不证明其他扩展已经被禁用，restore的true也不证明已恢复。本轮用抽取的原类和拒绝API的stub复现了这两条控制流，见 [platform离线探针](../../evidence/legacy/audit/platform/probe-results.json)；没有操作真实扩展。

新工程骨架没有 management 权限。建议暂不迁移此能力；若后续明确需要兼容提示，先仅检测/提示，将改变其他扩展状态作为独立功能设计。

## 6. 反馈的实际数据链路

```text
host 打开反馈 → OY → 注册 coco-feedback-modal CustomEvent bridge
  → 注入 /feedback-modal.js → 创建 DOM 对话框
  → requestFeedbackData(description)
  → host RY → 后台 getFeedbackData
  → submitFeedback(payload) → host FY
  → backgroundFetch POST <backend>/user/bug-report，JSON={json:payload}
```

来源：[host LF9415–9454](../../evidence/legacy/formatted/content-scripts/host.js#L9415)、[feedback-modal.js](../../evidence/legacy/formatted/feedback-modal.js)、[后台 LF9076–9085](../../evidence/legacy/formatted/background.js#L9076)。

payload 字段为 description、userInfo（匿名时 `{id:'anonymous'}`）、主配置白名单字段、pageInfo `{url,title,userAgent}`、ISO timestamp、扩展 version。白名单 EU 包含 provider/aiProviders/aiTranslate，**本次未见对嵌套 apiKey 的脱敏**。UI 文案说“附带日志和当前网页快照”，但在这条提交链中未找到日志数组、HTML 或截图数据，不能按文案声称已实现自动附带页面快照。

窗口 bridge 使用 namespace/instanceId/type 区分消息，不是来源授权机制；网页脚本也能构造 CustomEvent。重构应避免通过页面可监听事件返回完整配置/账户信息。该设计建议来自实际边界代码，不是对真实攻击发生的断言。

另一入口是页面翻译错误提示中的“上报问题”：`reportCurrentError()` 生成包含原因、类别、来源、provider、失败计数、错误名和堆栈的描述，再直接调用 `cAe → RY → FY`，不先打开反馈表单。提交中和成功状态阻止重复点击，失败后可再试；它复用同一配置收集及提交链路，因此也有上述未脱敏字段问题。来源：[host LF104991–105004](../../evidence/legacy/formatted/content-scripts/host.js#L104991)。这里的“自动上报”是生成描述的前缀，实际仍需用户点击。

反馈表单要求描述非空，提交时禁用按钮；成功后替换界面并 3 秒自动关闭；失败恢复按钮和错误文字。连续打开时若同 ID 对话框已存在，直接返回。host 注册监听由 r2 防止重复。

## 7. Sentry 与错误观测

后台/内容/UI 包中包含 Sentry 初始化代码。`RS()` 用全局标记防止重复；environment 固定 production；release 取 manifest.version；默认集成排除 BrowserApiErrors/Breadcrumbs/GlobalHandlers；beforeSend 返回原事件。初始化尝试记录时区并发送 `user.entered_app`；若 localStorage.authSession 有 email 则设置 email tag，后台没有 localStorage 的场景被 catch。[background LF1239–1299](../../evidence/legacy/formatted/background.js#L1239)。

翻译失败按 reasonType/provider/归一化原因聚合：每 60 秒窗口最多 3 次、同类至少间隔 1500ms。携带 reason、errorName、errorCount、stack、meta 等字段，identifier=`trans-error`。仓库保留原始 DSN 于旧包快照，本文不复制其值。静态代码只证明上报实现存在，不证明本次已成功上报。

用户反馈、普通日志和遥测是三条不同机制。重构建议先本地可诊断错误，再决定是否接入新的反馈/遥测服务，不沿用旧后端和 DSN。

可定位的初始化副本分别是后台 `RS`、host 的 `P2e` 和 popup 的 `jl`，见 [host LF3137](../../evidence/legacy/formatted/content-scripts/host.js#L3137)、[popup LF1290](../../evidence/legacy/formatted/chunks/popup-C6IAxVei.js#L1290)。配置里的 `tracesSampleRate=1` 不能单独证明实际生成或发送了性能追踪。后台调试函数 `Pt(e,t)` 仅调用 `IS()` 并丢弃返回值，没有日志输出；即便设置其检查的全局/localStorage标记，也不能据此声称该函数会开始打印日志，见 [background LF1246–1254](../../evidence/legacy/formatted/background.js#L1246)。

## 8. 建议模块与验收

| 批次 | 模块 | 验收 |
| --- | --- | --- |
| A | background lifecycle、typed messaging、tab state | worker 冷启动；重复初始化；页面消息不存在；内部页；tab关闭 |
| B | commands、context menus、badge | 自定义快捷键同步；不同UI语言；选区丢失；子frame；切tab状态 |
| C | screenshot下载/TTS | 下载取消；无tts；无voice；空文本；连续播放与stop |
| D | 本地诊断和反馈 | 脱敏快照预览；只发必要字段；失败重试；页面桥接不暴露密钥 |

当前未知：Chrome Web Store 对未来版本权限审核结果、指定旧冲突扩展的当前状态、旧反馈/Sentry 服务的当前运行状况。它们不影响在本地按模块重构前端逻辑。
