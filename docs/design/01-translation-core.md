# 翻译核心与供应商设计

状态：设计稿，待实施。共享请求、结果和错误协议见 [协议与数据](13-protocols-and-data.md)。本文涉及的旧接口仅为客户端兼容目标，服务现状须在集成时验证。

## 目标、责任与依赖

统一页面、划词、字幕等调用的语言处理、供应商适配、调度、缓存与取消。调用方负责生成 sessionId、generation 和 requestId，渲染前确认 generation 仍有效；后台负责网络与凭据。专家及术语快照见 [专家与术语库](10-experts-and-termbase.md)，账户与 Coco 见 [账户与服务](09-account-and-services.md)，配置见 [配置与界面](08-configuration-and-ui.md)。

## 数据与接口

以下是语义类型，非现有源码；客户端TranslationCommand包含关联字段、文本、语言、上下文及获准的override。后台解析配置后形成内部TranslationRequest，包含configRevision、实际providerId、model和promptProfileId。TranslationResult 包含相同关联字段、text、可选 detectedSourceLanguage、cacheHit和必填disposition。

```ts
interface ProviderAdapter {
  id: string;
  translate(request: TranslationRequest, context: ProviderContext): Promise<ProviderOutput>;
}
interface ProviderContext { signal: AbortSignal; prompt?: PromptSnapshot; temperature?: number }
interface ProviderOutput { text: string; detectedSourceLanguage?: string }
interface PromptSnapshot { system: string; user: string; revision: string }
interface TranslationService {
  translate(command: TranslationCommand, signal?: AbortSignal): Promise<TranslationResult>;
  cancelSession(sessionId: string, generation: number): void;
}
type CachedTranslation = {text: string; disposition: 'translated' | 'unchanged'};
interface CacheStore { get(key: string): Promise<CachedTranslation | null>; put(key: string, value: CachedTranslation): Promise<void>; clear(): Promise<void>; stats(): Promise<{bytes: number; entries: number}> }
```

错误遵循共享协议的 `kind` 分类与稳定 `code`，附可选 HTTP 状态及可重试标志；取消、超时、鉴权、配额、协议解析和不支持的供应商分别表达。adapter 返回空译文为协议错误，不伪装成成功。源目标语言相同时不调用 adapter，返回原文；普通供应商返回与原文相同的非空结果也原样透传。共享结果的disposition必填。同语言为same-language且cacheHit=false；返回文本与原文归一化后相同为unchanged，否则为translated。缓存记录保存该状态，命中时与当前关联字段一起返回，调用方无需从空串猜测原因。

## 供应商协议

| providerId | 客户端请求及解析 | 设计边界 |
| --- | --- | --- |
| google | GET `https://translate.googleapis.com/translate_a/single`，参数 client=gtx、sl、tl、dt=t、strip=1、nonced=1、q；拼接 response[0] 各段第0项。回退 GET `https://clients5.google.com/translate_a/t`，client=dict-chrome-ex、sl、tl、q，拼接字符串数组 | 403/408/429/5xx、网络或解析失败可回退；其他明确 4xx 不回退。旧第三层 POST `https://translate-pa.googleapis.com/v1/translateHtml` 的 body 为 `[[[text],from,to],"te_lib"]`、读取 `[0][0]`，依赖固定 key；新实现默认关闭，只有获得合法凭据及显式启用后才接入 |
| microsoft | POST Cognitive Translator `/translate?api-version=3.0&to=...&includeSentenceLength=true&textType=html`，非 auto 时加 from；body `[{Text:text}]`，读取 `[0].translations[0].text` | 旧 Android 风格 `X-MT-Signature` 依赖固定签名字节；不内置，需另行确定受支持的授权协议 |
| deeplx | POST `${baseURL}[/${apiKey}]/translate`，JSON `{text,source_lang,target_lang}`，读取字符串 `data`；非 auto 语言大写 | baseURL 是 DeepLX 服务根地址；官方 DeepL 协议单独适配，不把官方完整 endpoint 再拼 `/translate` |
| openai | OpenAI SDK Responses：`/responses` | 配置 model、key、baseURL；不改为 chat |
| deepseek | `/chat/completions`，Bearer key | 使用对应 SDK adapter |
| gemini | `/models/{model}:generateContent`，`x-goog-api-key` | 旧两个 2.5 thinking 型号附 thinkingBudget=128；型号及服务接受情况未验证 |
| custom | OpenAI 兼容 `/chat/completions` | 明确协议而非按 URL 猜测；需 baseURL 和 key |
| aihubmix | `/chat/completions`，旧独立简单提示词；空模型旧默认 `gemini-3.1-flash-lite-preview` | 不复制 custom URL 含域名时重复包装 prompt 的旧行为 |
| coco | POST `/api/v1/translate`，详见账户文档 | 非流式，服务端验证权限 |

Baidu、Youdao 旧 schema 有枚举但无已确认 adapter，新界面不提供。URL 去空白、尾斜杠及已填写的 `/chat/completions`、`/responses`、`/completions` 后缀后规范化版本路径；Gemini 保留 v1beta。密钥去首尾空白并拒绝不可见字符；不记录密钥。provider 的 customHeaders 旧路径未消费，新版仅在适配器明确声明支持时启用。

## 主流程与关键逻辑

```text
translate(command):
  validate command, allowed overrides and active generation
  req = resolve against current ConfigSnapshot
  text = trim(remove U+200B(req.text)); honor caller newline policy
  source = explicit non-auto source or detect(text)
  if source == target: return original with disposition=same-language and cacheHit=false
  snapshot = resolve provider + model + prompt + terms + context + settings
  identity = resolveIdentity(text, source, target, snapshot)
  key = SHA256(stableSerialize(identity))
  if enabled and valid cache hit: return correlated hit
  output = await scheduler.joinOrRun(key, subscriberSignal, adapter.translate)
  validate nonempty output and preserve every placeholder / HTML structure
  disposition = normalized(output) == normalized(text) ? unchanged : translated
  cache {text: output, disposition}; return correlated result if generation still active
```

语言检测先去标签与 `__CCPH数字__`，按汉字比例、简繁字表、短文本字符范围及长文本三元词频判断；不确定返回 auto。固定源语言和字幕显式覆盖应生效，语言标签统一 `_` 为 `-`。检测并非准确识别所有混合文字，尤其汉字与日文；调用方可显式指定。非 Coco 旧版把归一化后与原文相同的结果或仅占位符结果转空串；新版保留同文结果并以结构化状态供调用方判断，禁止仅占位符泄漏到 DOM。

队列去重和缓存使用同一完整 `ResolvedTranslationIdentity`：providerId、endpointId、credentialScopeId、model、源/目标语言、text、实际参数 optionsDigest、promptDigest、termbaseRevision 和 contextDigest。promptDigest以最终完整system/user内容计算，包含按URL匹配后实际注入的术语，关闭标题/域名增强也不省略这些术语。endpointId 标识实际端点，credentialScopeId 隔离凭据作用域而不包含明文密钥；不得只按供应商或文本去重。

调度器限制真实在途数，另按 requestDelay 控制发起间隔；同完整快照的任务可共享执行，每个订阅者独立取消，最后一个取消才 abort 底层请求。超时必须 abort，统一重试预算，关闭 SDK 的额外自动重试；指数退避 1 秒起加 0–10% 抖动，只重试可安全重试的网络/429/5xx，鉴权、配额、会员、协议错误不重试。Coco 是否重试须后端幂等契约支持。

## 配置、缓存与生命周期

默认普通 google；AI 默认关闭，provider openai、model `gpt-5-mini`。maxConcurrent=10、requestDelay=0ms、retryTimes=1、timeout=30000ms；缓存 enabled、maxSize=100 MiB、ttl=7 天。缓存后台 IndexedDB 按字节 LRU；命中检查 createdAt TTL，ttl=0 或 maxSize=0 均关闭持久缓存读写，避免无界存储；负数为无效配置。重新启用时不复用已过期记录。键包含语言、provider/model/temperature、完整 prompt 与术语版本、影响结果的上下文；不把原文或凭据写日志。初始化、读写失败降级为无缓存，允许后续重试初始化。配置变化使用新快照；取消、页面关闭和 generation 更新不渲染旧结果。

## 旧行为与设计差异

| 旧行为 | 新设计 |
| --- | --- |
| 普通入口忽略固定源语言；显式入口优先覆盖 | 单一明确优先级，调用方显式源语言生效 |
| 令牌桶默认突发30、每秒20，不检查真实并发；超时不取消 | 真正并发上限和 abort，统一重试预算 |
| 去重键不含模型和 prompt；缓存键遗漏术语上下文，读取不查 TTL | 完整快照键，读取查 TTL |
| 普通 AI temperature 在队列丢失；专家与模板互斥 | 显式传参并按确定规则组合 |
| Google 代理网络失败包装 status=0 导致不回退 | 统一网络错误分类后回退 |
| DeepLX 默认值与协议矛盾 | 将 DeepLX 根地址与官方协议分离 |

## 验收用例

1. 用离线夹具验证各路径、请求体和解析、畸形响应及 Google 可回退/不可回退状态；第三层默认不调用。
2. 显式源语言、auto、同语言、换行、HTML 与占位符均符合契约；过期 generation 和取消请求不渲染。
3. 模型、temperature、术语或上下文任一变化不共享任务和缓存；相同完整快照多订阅者取消互不影响；同文本、同术语revision但不同URL命中不同术语库时不能串缓存。
4. 测量实际并发、请求间隔、超时 abort、重试次数及缓存 TTL/LRU；IDB 故障不阻断翻译。
5. 缺 key、非法 URL、401、404、429、配额和未知 provider 返回稳定错误；真实服务测试需单独配置授权。
