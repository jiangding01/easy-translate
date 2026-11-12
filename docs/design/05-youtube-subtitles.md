# YouTube 字幕捕获、翻译与覆盖显示

状态：待实施。本文定义 YouTube 专用路径；真实播放器私有接口、签名与站点结构须在实施时验证。字幕阅读见 [06](06-subtitle-reading.md)，通用翻译见 [01](01-translation-core.md)，跨上下文协议与生命周期见 [13](13-protocols-and-data.md)。

## 目标、责任和依赖

捕获当前视频已有字幕，选取源轨、解析为整数毫秒 cue，按播放位置翻译并显示，支持下载原文 SRT。内容世界管理状态、调度与 UI；页面世界适配播放器及观察网络；后台只执行授权的翻译。两世界通过 [13](13-protocols-and-data.md) 消息协议及 requestId、sessionId、generation 关联；页面数据不被视为可信命令。配置读取和变更遵循 [08](08-configuration-and-ui.md)，语言、字幕样式与开关必须可热更新。

## 数据与流程

```ts
type Track = { id: string; language: string; kind: 'asr' | 'human'; name: string; url: string };
type CueState = SubtitleCue & { state: 'idle' | 'loading' | 'done' | 'error' }; // SubtitleCue 见 13
type VideoSession = { videoId: string; generation: number; cues: CueState[]; active: number | null };
type Capture = { videoId: string; tracks: Track[]; json3?: unknown; observedUrl?: string };
```

页面世界包装 fetch 和 XHR，观察 player 和 timedtext 成功响应，fetch 使用 clone，XHR 保留原处理器；记录视频身份、轨道、响应及必要请求上下文。桥只接受白名单消息，校验来源、结构与会话，不允许页面发起任意后台请求。优先播放器响应/当前视频缓存，其次初始响应及页面 HTML；所有回退必须核对 videoId。选轨后构造 JSON3 URL，复用观察到的播放器上下文和音轨令牌；不记录或输出完整签名 URL。优先使用有效缓存；无 pot 时先限时等待观察数据，再 fetch JSON3。正文无效时切换原生 CC 并限时观察，再按最新上下文重组 URL 重试一次；首次 fetch 抛错按新设计也可进入受总截止时间约束的恢复。音轨按 vssId 或语言加 kind 匹配 pot/potc，匹配项缺令牌时可回退最近观察 URL；上下文使用最近 timedtext 参数，缺项再取播放器配置。失败时显示可重试错误，不声称站点支持必然有效。

```text
onVideo(videoId):
  cancel old session; generation++
  capture = await bridge.capture(videoId, bounded deadline)
  groups = [tracks excluding CC-marked names, all tracks]
  track = K(tracks, normalizedSourceLanguage) or Rt(tracks)
  K: examine non-CC group then all tracks; within each group select
     matching ASR, then matching non-ASR, then any matching track
  Rt: use non-CC group if nonempty, otherwise all tracks; select first ASR or first track
  json = await fetchOrObserveJSON3(track, bounded deadline)
  cues = parseJSON3(json) or parse supported fallback format
  publish only if session and generation still current
onTime(currentTimeSeconds):
  tMs = round(currentTimeSeconds * 1000)
  cue = cursor lookup (current, next, then binary search)
  render cue; always schedule the current matching cue when idle
  also schedule other idle cues starting within tMs ± 10000 ms
```

JSON3 是主路径，原始毫秒归一为整数毫秒；所有 cue 均满足 `endMs > startMs`。带标点或足够多词段以标点结束的 ASR 按词 offset 切段：间隔超过 1200ms、句末标点、超过 30 字符且逗号结尾或累计超过 100 字符时分段；无标点 ASR 事件两两合并，有 offset 时按最大 offset 推导事件时长，无时长默认 5 秒。非 ASR 缺时长时依次尝试小于 60 秒的下一条起点差、视频剩余时长，再默认 5 秒。音乐标记保留为独立段并按文本权重分配时间。通用格式解析作为 fallback，支持 VTT、SRT、XML/TTML 和普通 cue；它不意味着其他站点已有接入。校验非空文本、有限时间及 endMs > startMs，稳定排序并生成 cue 身份；重叠时明确采用最先匹配的单条显示。源语言与目标语言按统一语言规则相同则跳过翻译，显示策略由原文/译文开关决定。

## 默认值、边界与生命周期

播放窗口默认 ±10 秒；网络和桥请求设有限截止时间。字幕协调层每句至多三次完整逻辑尝试，所有 provider、队列和 SDK 网络调用共同消耗 [01](01-translation-core.md) 的同一重试预算；关闭 SDK 自动重试，不允许三层相乘。取消、鉴权或配额错误立即终止，不重试；仅可安全重试的错误按预算退避。失败进入 error 并允许用户手动发起新任务；旧递归重试没有把子 Promise 接回父 Promise，首次 false 后可能永不完成，不能复用。后台并发与缓存遵循 [01](01-translation-core.md)。缓存键至少包含 videoId、轨道、语言和翻译配置身份，设置容量及有效期；不得把带签名 URL、账户凭据写入诊断。播放器切换、SPA 导航、关闭或配置变化时取消队列、解绑监听、恢复 hook（仅在仍为自己的包装时），并丢弃旧 generation 回包。广告期间隐藏覆盖层，结束后按当前时间恢复。

下载只导出当前源 cue 的 SRT，时间格式 `HH:MM:SS,mmm`，不受译文开关影响；空列表提示无内容。注入失败不得遗留阻止重试的加载标记。

## 旧行为与设计差异

| 项目 | 旧行为 | 新设计 |
| --- | --- | --- |
| 选轨 | 先非 CC 组，再全部；组内 ASR 优先，人工优先参数在 YouTube 路径无效 | 保持组序及组内优先级，UI 不承诺人工优先 |
| 捕获 | fetch/XHR 捕获上下文；请求回退部分无全局等待上限 | 校验视频身份，统一截止与取消 |
| 翻译 | ±10 秒窗口；递归 Promise 存在悬挂缺陷 | 保留窗口，使用有界可取消重试 |
| 缓存 | 部分 session 缓存仅按 videoId，可能跨语言污染 | 按轨道及翻译配置隔离并限期 |

## 验收

- 非 CC 人工轨与 CC ASR 同时存在时选前者；同组人工/ASR 选 ASR；无匹配语言时按组回退。
- fetch 与 XHR fixture 均可捕获且原页面响应不受影响；缺令牌、无效 JSON3、CC 回退、超时均有确定结果。
- JSON3 ASR、音乐标记、重叠与缺时长、VTT cue settings；seek后始终调度当前命中cue，另调度窗口内cue，持续超过20秒的长cue中段跳转也可翻译；验证总网络调用不超过统一预算，取消、鉴权和配额不重试；三次失败后不悬挂。
- 快速切换视频及关闭时旧响应不写入；源 SRT 的时间、文本正确，注入失败后可重试。
