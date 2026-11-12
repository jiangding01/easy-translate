# 字幕阅读与文章模式

状态：待实施。输入来自 [YouTube 字幕](05-youtube-subtitles.md) 的当前视频 cue；普通翻译依赖 [01](01-translation-core.md)，账户状态依赖 [09](09-account-and-services.md)，会话与消息遵循 [13](13-protocols-and-data.md)。文章服务契约需独立实现和验证，旧服务可用性未知。

## 目标与职责

提供字幕列表、文章模式、原文/译文/双语显示、句子跳转、提示词重译和原文 SRT 导出。阅读会话负责队列、缓存与视图，播放器宿主管理移动与恢复；不从音频生成字幕，也不提供字幕专用朗读。

```ts
type ReadingItem = { cueId: string; startMs: number; endMs: number; text: string; timestamp: string };
type ChunkRequest = { items: ReadingItem[]; prompt: string; fromLang: string; toLang: string; title?: string; author?: string };
type ChunkResponse = { items: Array<{ timestamp: string; text: string }> };
type Result = { state: 'idle' | 'loading' | 'done' | 'error'; text?: string; error?: string };
```

## 主流程与关键逻辑

所有 cue 时间遵循 [13](13-protocols-and-data.md) 的整数毫秒且 `endMs > startMs`；读取播放器 `currentTime` 时乘 1000 并取整，跳转写入时将 `startMs` 除以 1000。打开时暂停视频，保存播放器原 parent、nextSibling 与占位符；点击句子 seek 后尝试播放，播放失败明确显示。字幕模式以当前句向前至首句再向后排序；默认逐句并发 3、每 120ms 调度最多 8 句、运行和排队合计最多 12，调用普通翻译。相同文本可复用，但需隔离语言及服务配置，空结果、同文与失败分开表示。

文章模式按顺序每 50 句分块，空文本不送出，最多同时处理 2 块。每块响应必须与请求数量相同、timestamp 逐项相同且至少一项非空；允许部分为空。

```text
translateChunk(chunk, retryBudget):
  for attempt in 1..3:
    if retryBudget has no remaining network attempt: break
    consume one network attempt before sending
    try response = await articleService(chunk, automaticRetries=0)
    catch cancellation: stop
    catch transportException: return fallbackIfConfigured(chunk)
    if response indicates login required: mark error; offer login once per session; return
    if response indicates quota, membership or no-access: mark error; return
    if response is success and valid count/order/nonempty: commit; return
    if response is not retryable: return fallbackIfConfigured(chunk)
    if backend idempotency not confirmed: return fallbackIfConfigured(chunk)
    wait bounded backoff before the next permitted attempt
  return fallbackIfConfigured(chunk)
```

兼容基线是最多三次文章调用，非登录响应错误/格式不合格继续，抛异常立即逐句回退，登录错误不回退。新设计将三次作为操作上限，并受01章统一预算及后端计费幂等条件限制；未确认幂等时单次发送，不自动重发。配额/会员/无权访问直接显示错误，不在文章和普通翻译间循环。解析错误直接进入配置允许的逐句回退。回退仅在已配置普通翻译可用时执行，使用独立受控任务与预算；不可用时保留原文并显示错误。结构化错误码替代旧文案匹配。

## 缓存、配置和生命周期

默认文章提示词：将 YouTube 采访字幕翻译成流畅对话并保留核心表达；允许编辑。三类缓存键均叠加模块13的完整ResolvedTranslationIdentity，包括实际端点、凭据作用域、模型、语言、参数、Prompt、术语及上下文等实际影响输出的字段。普通逐句键在该身份上加入归一文本；文章块键额外加入videoId、按序cue身份和文章Prompt版本；文章行键加入相同文章作用域及该cue身份。未使用的参数采用固定空值，不将不同服务身份混为同一缓存。旧逐句内存缓存键仅为 trim 后文本，旧文章块队列键为按顺序拼接的 timestamp，旧文章行持久缓存作用域为标题、作者、语言和提示词散列，再按 cue 身份存值；上述旧键缺少必要隔离。新键不得按标题/作者或裸文本跨会话复用。缓存限制容量及有效期，配置统一由 [08](08-configuration-and-ui.md) 管理。

提示词或语言变化递增功能generation，视频变化使旧视频session失效并创建新session，取消可取消请求，忽略已发出但不能取消的旧回包。关闭、Escape 或遮罩点击均销毁队列、观察器、定时器及视图。恢复播放器到占位符；若原 sibling 已移除则安全追加到仍连接的原 parent，原 parent 已失效则由站点重建播放器并提示。关闭不自动宣称恢复原播放状态。导出始终为源 SRT。

## 旧行为与设计差异

| 项目 | 旧行为 | 新设计 |
| --- | --- | --- |
| 文章调度 | 50 句、并发 2，最多三次；异常立即回退、登录例外 | 保持分块和上限，增加共享重试预算、计费幂等门槛及配额/权限立即失败 |
| 缓存 | 逐句仅 text；文章按标题、作者、语言及提示词散列，不含 videoId | 三类键明确隔离视频、cue 及翻译配置 |
| 返回处理 | prompt 版本避免旧结果写回，但未取消已发请求 | 取消可取消请求并用 generation 防迟到 |
| 播放器 | 移动后恢复，播放 Promise 失败被吞 | 安全恢复并显示播放失败 |

## 验收

- 0、1、50、51、101 句和空句、重复时间戳；核对分块及并发上限。
- 缺句、多句、乱序、全空、部分空；分别验证总调用数最多三次，预算充足且持续遇到可重试错误时恰好三次、零预算不发请求和每次请求先扣预算、三次上限、未确认幂等时一次调用、抛异常一次即按配置回退、配额/会员不重试、登录错误不回退且每会话最多提示一次。
- 修改提示词或切视频后旧响应无法写入；三类缓存对视频、语言、模型和提示词变更正确失效。
- 关闭、遮罩、Escape 及原 sibling 消失时播放器恢复，seek 失败可见，源 SRT 不含译文。
