# 13 通信协议与共享数据契约

[方案入口](README.md) · [整体架构](00-architecture.md)

本章定义待实施的共享契约。TypeScript片段用于描述数据形状，实际消息边界还需运行时校验。

## 1. 标识与请求封装

```ts
interface RequestEnvelope<T> {
  protocolVersion: 1;
  type: string;
  requestId: string;
  sessionId: string;
  generation: number;
  payload: T;
}
interface ResponseEnvelope<T> {
  protocolVersion: 1;
  requestId: string;
  sessionId: string;
  generation: number;
  outcome:
    | { ok: true; data: T }
    | { ok: false; error: AppError };
}
interface AppError {
  kind: 'validation' | 'network' | 'provider' | 'auth' | 'quota'
    | 'timeout' | 'cancelled' | 'unsupported' | 'internal';
  code: string;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}
```

`requestId`关联一次调用，`sessionId`关联某一功能控制器，`generation`标记该功能会话的有效轮次。多个功能可以同属一个tab/frame但有独立sessionId；跨文档导航使该frame全部旧会话失效，同文档重扫只推进相关generation。后台从浏览器提供的sender确定tab和frame，页面传来的tabId仅可作为经验证的业务参数。

所有handler的同步抛错和Promise拒绝统一归一化。参数校验、取消、超时和业务失败采用稳定code，用户界面使用可本地化文案。底层消息断连在客户端适配器处映射为可诊断错误。

## 2. 翻译契约

```ts
interface PageContext {
  url?: string;
  title?: string;
}
interface TranslationOverride {
  providerId?: string;
  model?: string;
  promptProfileId?: string;
}
interface TranslationCommand {
  requestId: string;
  sessionId: string;
  generation: number;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  context?: PageContext;
  override?: TranslationOverride;
}
// 后台解析得到的内部请求，provider参数具有确定来源。
interface TranslationRequest extends Omit<TranslationCommand, 'override'> {
  configRevision: number;
  providerId: string;
  model?: string;
  promptProfileId: string;
}
interface TranslationResult {
  requestId: string;
  sessionId: string;
  generation: number;
  text: string;
  detectedSourceLanguage?: string;
  cacheHit: boolean;
  disposition: 'translated' | 'same-language' | 'unchanged';
}
```

封装与payload出现的归属字段必须相等。扩展消息接收TranslationCommand；后台从当前ConfigSnapshot选择普通/AI服务及其参数，解析为内部TranslationRequest。override仅限已实现的划词服务选择和字幕专用选择等入口，由消息handler结合sender、操作类型和允许的provider/model白名单校验；普通网页翻译默认不接受覆盖。优先级为获准的单次override高于当前配置，未指定字段沿用配置。全局promptProfileId仍是唯一持久选择，单次覆盖不写配置。内部请求移除override，仅保留其校验后解析出的字段。后台继续解析温度、凭据作用域、术语及Prompt版本，形成实际provider请求和缓存键，未知字段拒绝。

设置连接测试使用单独的受限消息，不复用TranslationCommand的override：

```ts
interface ProviderConnectionTest {
  providerId: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  temperature?: number;
}
```

该消息只接受经过sender校验的扩展设置页，内容脚本和页面桥无调用权。参数来自未保存草稿，后台按provider schema验证模型、端点协议/来源及适用字段，在隔离上下文中执行有截止时间的最小测试。候选key仅用于本次请求，不落盘、不进正式缓存/日志/诊断，也不回显在响应；响应只返回成功状态或脱敏错误。测试失败、取消和成功均不改变当前配置。

对`auto`、已知源语言及UI语言分别处理。`disposition`分别表达生成译文、同语言返回原文和译文与原文归一化相同，调用方据此决定是否插入节点。同语言结果的cacheHit为false。适配器的空响应按其协议定义校验，网络失败不会吞为空译文。仅占位符或破坏占位符的响应归为协议错误，不渲染。

## 3. 语义缓存与任务去重

```ts
interface ResolvedTranslationIdentity {
  providerId: string;
  endpointId: string;
  credentialScopeId: string;
  model?: string;
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
  optionsDigest: string;
  promptDigest: string;
  termbaseRevision: number;
  contextDigest: string;
}
interface CacheRecord {
  key: string;
  text: string;
  disposition: 'translated' | 'unchanged';
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  estimatedBytes: number;
}
```

identity经过稳定序列化后散列。optionsDigest包含实际生效的参数。promptDigest必须散列适配器最终使用的完整system/user内容，包括选中的专家、模板、匹配后的术语和占位符指令。contextDigest包含实际进入请求的上下文；即使关闭上下文增强，URL匹配出不同术语时也会通过最终promptDigest区分。credentialScopeId用于隔离凭据作用域，不保存明文key。缓存读时校验expiresAt，命中后更新使用时间，超限按使用时间淘汰。记录同时保存disposition，命中时以当前请求关联字段构造结果；same-language提前返回，不进入缓存。ttlDays或maxSizeMiB为零时关闭持久缓存读写，负数拒绝。

同identity任务可共享执行，但订阅者保留各自requestId/sessionId/generation。撤销一个订阅不影响仍有效的订阅者。全部订阅失效才中止底层请求。超时需同时取消网络，并处理超时后仍返回的旧响应。

## 4. 业务消息目录

| 类型族 | 主要操作 | 校验及响应 |
| --- | --- | --- |
| config | get、patch、reset、changed | path/value白名单、expectedRevision、更新后revision |
| translation | translate、cancel、progress | 大小/语言、受限override、后台解析provider、订阅归属 |
| provider | testConnection | 仅可信设置页、临时候选参数、脱敏结果、无持久副作用 |
| page | getState、start、stop、revalidate | sender归属、generation、当前真实状态 |
| subtitle | translateCue、translateArticleChunk | cue时间戳、条数、块ID、登录类错误 |
| cache | getStats、clearScope | 允许的缓存范围，返回聚合信息 |
| account | beginSignIn、consumeCallback、getStatus、signOut | 回调来源/参数、会话归属、脱敏状态 |
| platform | capture、download、speak、stopSpeech、openPage | 窄参数、sender窗口、任务状态 |
| feedback | preview、submit | 显式诊断白名单、确认后的载荷 |

具体类型以实现时的schema和TypeScript映射共同约束。旧34个常量名及动态代理属于兼容来源，不能仅按名称数量推导新接口或功能可达性。

## 5. 配置写入与广播

```ts
interface ConfigPatch {
  expectedRevision: number;
  changes: Array<{ path: string; value: unknown }>;
}
interface ConfigSnapshot<T> {
  schemaVersion: number;
  revision: number;
  data: T;
}
```

后台串行处理补丁，校验路径及新数据，构造revision递增后的完整ConfigSnapshot，并以单个storage键的一次写入持久化数据和revision。持久化成功后才更新内存、回复和广播；失败时保留当前快照。旧expectedRevision返回冲突，客户端获取新快照后由用户操作或确定性的补丁规则重试。广播完整快照或含revision的失效通知，消费者忽略旧revision，避免重复广播导致重启循环。

UI的500ms自动保存保留待保存、保存中、已保存、失败状态。保存失败保留草稿，并提供重试。服务连接测试使用未持久化候选参数，成功和失败都不会隐式改变当前配置。

## 6. 页面世界字幕桥

桥使用专用namespace、protocolVersion、bridgeSession、requestId、type、payload。内容脚本在当前页面会话内关联应答，校验event.source、namespace、会话、消息类型和结构，并限制响应大小。超时拒绝或返回明确错误，销毁时使所有待处理请求settle并移除监听。

桥Session属于相关性与隔离机制。与宿主页面共享的执行世界不能成为密钥或浏览器特权的授权边界。允许消息仅包括获取轨道、字幕、播放器上下文和控制字幕触发等窄操作。

## 7. DOM与字幕数据

```ts
interface TextUnit {
  id: string;
  sessionId: string;
  generation: number;
  sourceText: string;
  sourceDigest: string;
  placeholders: Record<string, string>;
}
interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  translation?: string;
}
```

DOM引用保留在内容脚本内，传输文本单元及占位符数据。写回前确认节点仍连接、源摘要及generation未变。字幕使用整数毫秒，校验endMs大于startMs且排序稳定；导出时才转SRT/VTT/TXT格式。

文章块携带video/session、chunkId、items的顺序和时间戳。响应须完整校验长度、位置及时间戳，不能以相同条数代替逐位置验证。正文与译文的实际缓存键见[阅读模块](06-subtitle-reading.md)。

## 8. 协议验收

覆盖未知type、畸形payload、超长文本、旧revision、同步抛错、后台断连、迟到失败、重复应答、桥应答type不匹配、切页面后应答、共享任务单方取消及全部取消、越权override、内容脚本伪造连接测试、未保存端点/key测试、普通/AI服务选择切换、相同术语revision但不同URL命中不同库。序列化后再校验结果，特别检查undefined、错误对象和不可克隆值。
