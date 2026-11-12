# 浏览器平台、反馈与生命周期

状态：待实施。权限和资源边界由 [12](12-i18n-and-assets.md) 定义，消息与 requestId、sessionId、generation 由 [13](13-protocols-and-data.md) 定义；配置和账户分别见 [08](08-configuration-and-ui.md)、[09](09-account-and-services.md)。本文不假设历史反馈或遥测服务仍可用。

## 目标与责任

后台 Service Worker 负责幂等注册浏览器事件、菜单、快捷键、tab 状态、截图、下载及 TTS；内容和 UI 只通过类型化消息请求明确能力。反馈收集和上报独立于遥测，所有敏感资料留在可信扩展上下文。冷启动必须恢复持久状态，不依赖 worker 常驻。

```ts
type TabState = { tabId: number; enabled: boolean; generation: number };
type PlatformRequest =
  | { type: 'captureVisibleTab' }
  | { type: 'downloadImage'; dataUrl: string; filename: string; saveAs: boolean }
  | { type: 'ttsSpeak'; items: Array<{ text: string; lang?: string }> }
  | { type: 'ttsStop' };
type Feedback = { description: string; page: { url: string; title: string }; version: string;
  settings: Record<string, unknown>; error?: { category: string; message: string } };
```

## 启动与平台流程

```text
onWorkerEvaluation:
  synchronously register runtime, commands, menus, tabs and lifecycle listeners once
  initialize persisted config and queues asynchronously; surface initialization failures
onInstalled or onStartup:
  reconcile menu IDs and localized titles idempotently
onCommand/menu(tab):
  validate tab and restricted URL; send typed action to appropriate frame
  if no receiver: return actionable unavailable state
onTabClosed: remove tab state and pending operations
```

右键提供选区翻译和页面切换；命令默认 Alt+X 切换页面翻译、Ctrl/Command+Shift+Z 截图，读取浏览器当前快捷键以展示用户修改。badge 根据 tab 的实际翻译状态更新；不可访问内部页不得误报可用。action 配置 popup 时以 popup 为主入口，不依赖 onClicked。菜单按 UI 语言重建，避免重复；worker 重启从持久配置重建必要状态。

截图以captureSession订阅tabs.onActivated、导航和窗口生命周期事件，中途变更使会话不可逆失效。调用前后核对失效标记及发送方tab仍是其窗口活动标签，验证调用上下文与授权，丢弃失效会话的captureVisibleTab结果。切走再切回也不能恢复旧会话，实际事件时序须浏览器验收。成功时返回受限数据；下载默认弹保存对话框，取消与失败分开报告。TTS 过滤空文本，先 stop，再按语言依序入队；兼容回调与 Promise，仅完成一次；无 API、无 voice 和运行错误反馈给调用者。stop、页面关闭及新一轮播放明确取消旧队列，入队成功不等于实际播完。

## 反馈、权限与观测

反馈有两个入口：用户打开反馈表单填写描述；页面翻译错误提示中用户点击上报，自动构造错误描述。两者进入同一可信后台收集和提交路径。旧 payload 包括 description、userInfo、配置白名单、页面 URL/title/userAgent、时间和版本；其嵌套 provider 配置未见密钥脱敏，旧表单文案提到日志和页面快照，但该链路未发现日志数组、HTML 或截图。新设计仅收集必要字段，剔除凭据、令牌及 URL 敏感参数，提交前可预览；错误栈按需清理。表单提交中禁用重复提交，失败可重试；错误入口同样需要用户点击。

```text
submitFeedback(input):
  require nonempty description
  payload = buildMinimalPayload(input, sanitized settings, sanitized page)
  show preview and submit only after user action
  send to explicitly configured endpoint with deadline
  report success or retryable failure
```

页面可构造 CustomEvent，namespace 和 instanceId 不是权限校验；不得通过页面事件暴露完整配置或账户信息。扩展消息校验 sender、请求类型和数据，网络请求由业务限定目标与权限，不复用无限制 backgroundFetch。Sentry 的旧初始化在后台、host 和 popup 多上下文存在；旧 beforeSend 原样返回事件，存在隐私风险，其代码存在不证明上报成功，也不能单凭采样配置推断性能追踪。新遥测默认关闭，若启用须在每个上下文统一过滤、限流和可关闭，且不复制旧 DSN 或凭据。网络事件通过 `onEvent` 仅发出脱敏的请求阶段、目的地类别、状态码、耗时和错误类别；不得携带完整 URL、请求/响应正文、headers、cookie、令牌或任何完整凭据。监听器异常不得改变网络请求结果，取消或销毁时解除订阅。

旧冲突扩展启动检查实际只读状态并返回 true，没有禁用；手动禁用/恢复内部吞掉 setEnabled 失败，上层成功不能证明状态变化，也未证实卸载自动恢复。本设计不申请 management 权限或修改其他扩展；如将来需要，另行设计明确授权和读回验证。

## 旧行为与设计差异

| 项目 | 旧行为 | 新设计 |
| --- | --- | --- |
| 启动 | 分段 catch 后继续，worker 内存状态可能丢失 | 幂等同步注册，初始化失败可见并恢复持久状态 |
| 页面可用性 | ping 抛错仍可返回可尝试 | 受限页或无 receiver 明确不可用 |
| 反馈 | 两入口复用收集链，嵌套密钥未见脱敏；页面事件桥可被伪造 | 可信上下文最小化、脱敏预览和 sender 校验 |
| 冲突扩展 | 自动检查是空操作，手动路径可能吞失败 | 不管理其他扩展 |

## 验收

- worker 冷启动、重复初始化、语言变化与 tab 关闭；菜单唯一、快捷键同步、badge 对应 tab 实际状态。
- 受限页面、无内容脚本、子 frame、无截图权限、截图中切走再切回、下载取消及 API 失败均返回可区分结果。
- TTS 空文本、无 API/voice、重复回调与 Promise、连续 speak/stop，验证只完成一次及队列清理。
- 两种反馈入口均可预览并去除嵌套密钥和 URL 敏感参数；伪造页面事件不能读取配置或触发特权调用；上报失败可重试。
- 三个上下文遥测关闭时无发送；启用时过滤和限流一致；network onEvent 不包含完整 URL、请求体、响应体或凭据，监听器异常不影响请求。旧服务状态与商店权限审核需另行验证。
