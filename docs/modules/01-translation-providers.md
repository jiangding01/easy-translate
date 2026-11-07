# 01 · 翻译服务、提示词、调度与缓存

## 1. 范围与证据等级

本模块恢复 `1.0.109` 安装包中可静态确认的翻译调用管线。原包只有压缩后的构建代码，本文保留压缩符号，语义名称是解释，不是恢复出的原始 TypeScript 名称。

- **已确认**：函数体、分支、参数映射、存储名称、错误处理与调用关系。
- **推断**：某些分支在实际页面下的到达条件、供应商服务的可用性。
- **未验证**：任何外部服务的当前响应、收费模型是否仍可用、真实翻译质量。此次没有调用旧后端或使用包内凭据。
- 文中行号按冻结排版文件的 **LF 换行**计数；排版版本只便于阅读，原始字节与 SHA-256 见 [inventory.json](../../evidence/legacy/inventory.json)。

主要证据：[后台代码](../../evidence/legacy/formatted/background.js)、[API 页面侧副本](../../evidence/legacy/formatted/chunks/api-CQ3fxAZ4.js)、[代码摘录索引](../../evidence/legacy/extracts/providers/index.json)。本模块为普通静态代码核对；REA 总体覆盖范围与局限见入口证据说明，不能把依赖 SDK 的全部能力当作本插件功能。

## 2. 实际入口与调用链

```text
页面/划词等调用 translateText（DL）
字幕消息 translateSubtitle → DL 或带语言覆盖的 $L
  → 清理文本、识别语言、选择普通/AI服务、读AI缓存
  → vk → hk
      Google/Microsoft → OL → dw/mw（直接调用，不走 pU）
      DeepLX/AI/AiHubMix/Coco → jL构建任务 → bw → pU → gU映射
          deeplxTranslate → pw
          aiTranslate → lw → EB/SB → SDK generateText($D)
          aihubmixTranslate → Mc → OpenAI兼容 chat.completions
          cocoTranslate → Pc → 自有后端 /translate
  → 相同译文检测、占位符异常检测、写缓存、返回字符串
```

网页脚本怎样提取和渲染参见 [02-page-translation.md](02-page-translation.md)；Coco 登录与付费状态参见 [07-account-and-backend.md](07-account-and-backend.md)。

来源：后台 LF 7678–7816、8971–8980、9059–9070；相关代码完整摘录在 [provider-routing.js](../../evidence/legacy/extracts/providers/provider-routing.js)。

### 2.1 两个文本翻译入口的区别

`DL(text, optionalConfig, options)`：移除 U+200B 和首尾空白；默认把换行压成空格，`options.preserveNewlines` 才保留换行。调用 `mk` 从文本检测源语言，**这里未使用配置的固定 `language.sourceCode` 覆盖识别结果**。识别语言与目标语言相同时直接返回原文。AI 开启且有 provider 时使用 AI，否则使用 `provider.provider`。

`$L(text, {fromLang,toLang}, optionalConfig, ...)`：显式语言覆盖优先；覆盖值会把 `_` 换成 `-`，`auto` 不视为显式语言。源语言顺序是：显式 `fromLang` → 非 auto 的配置源语言 → 检测值；目标为显式 `toLang` → 配置目标语言。其换行始终压成空格。

两者入口仅剔除 U+200B；非 Coco 返回结果若和原文归一化后相同，返回空字符串。`fk/yk` 的比较会解 HTML 实体、合并空白、统一部分中英文标点、忽略大小写及句末标点；以 `#` 开头的任一文本不作相同判定。若译文仅为 `__CCP...` 一类占位符、原文却不是，返回空字符串，防止页面泄露错误占位符。空字符串因此表示“无需插入译文/异常占位符过滤”，不等同于网络失败。

来源：[后台 LF 7703–7816](../../evidence/legacy/formatted/background.js#L7703)。

### 2.2 语言检测并非仅 HTML lang

`mk` 先用 `IL` 移除 HTML 标签及 `__CCPH\d+__` 占位符；按有效字符统计汉字占比，达到代码阈值时走 `pk` 简繁字表；很短的文本去掉空白、数字、标点后长度不超过 12 时走文字范围检测 `AL`；较长文本用内置三元词频分类器 `mL`，将 ISO 三字母映射为常用语言代码，不确定返回 `auto`。这里的 `zh`、`zh-CN`、`zh-TW` 不完全等价，原代码的 `E === O` 只是严格相等。

来源：后台 LF 7609–7677。分类词表本身仍保存在原包及排版文件，本文不把字典常量重新抄一遍。

## 3. 服务矩阵：枚举不等于实际支持

| 服务 | 可确认实现 | 请求路径 | 原行为/边界 |
| --- | --- | --- | --- |
| Google | `dw`，含 GTX → clients5 → 可选 translate-pa 回退 | 见下文 | 免费直接通路，不经 pU；各回退接口的响应结构不同 |
| Microsoft | `mw` + `WB` 签名 | Cognitive Translator `/translate` | 请求用 Android 风格签名；不是用户 key 的订阅版实现 |
| DeepL | `pw` 实际是 **DeepLX 兼容 JSON** | `${baseURL}[/${apiKey}]/translate` | 默认值却是官方 DeepL 完整 endpoint，拼接后未必有效；不能把“配置默认值”当作成功证据 |
| OpenAI | `lw` → `co` | SDK `/responses` | `co.languageModel`默认指向responses模型；不要一律假定走chat/completions |
| DeepSeek | `lw` → `Ck` | `/chat/completions` | Bearer key，SDK 模型适配器 |
| Gemini | `lw` → `Dk` | `/models/{model}:generateContent` | `x-goog-api-key`，thinking 特例见下文 |
| custom | `lw` → `SB` 的 `n` 包装 | `/chat/completions` | 强制 OpenAI chat 兼容模型；需 baseURL 和 apiKey |
| AiHubMix | `Mc`，另有 SDK 注册副本 | `/chat/completions` | 使用自己的简单提示词，未走 `dh` 专家/术语提示词 |
| Coco | `Pc` | 自有 `/api/v1/translate` | 需账户 accessToken，后端负责计划权限和配额 |
| Baidu、Youdao | **没有确认到实际适配器** | 无 | 虽在普通 provider schema 枚举中，`jL`/`gU` 没有映射，派发会报 Unsupported provider |

AiHubMix 的 `jL` 直接传 model；为空时 `Mc` 自己使用 `gemini-3.1-flash-lite-preview`，与 `va.aihubmix[0]` 不同。[后台 LF7687–7691、8847–8857](../../evidence/legacy/formatted/background.js#L7687)。

额外配置边界：schema有`provider.customHeaders`，但所核对的适配器调用没有消费该字段；Google/Microsoft使用`ts.google/ts.microsoft.baseURL`，而非读取通用`provider.baseURL`。DeepLX才读取通用provider URL/key，AI读取各自`aiProviders`配置。

来源：后台 LF 2552–2554（schema），2702（默认值），7678–7701（派发），8671–8880（适配器），8980（gU）；[API副本 LF 3512–3692](../../evidence/legacy/formatted/chunks/api-CQ3fxAZ4.js#L3512)。

### 3.1 Google 的三级回退

1. `BB`：GET `https://translate.googleapis.com/translate_a/single`，参数 `client=gtx, sl, tl, dt=t, strip=1, nonced=1, q=encodeURIComponent(text)`。读取 `response[0]` 数组中各段 `[0]` 拼接。
2. `UB`：GET `https://clients5.google.com/translate_a/t`，参数 `client=dict-chrome-ex, sl, tl, q`。要求 JSON 是字符串数组，再拼接。
3. `qB`：POST `https://translate-pa.googleapis.com/v1/translateHtml`，`Content-Type: application/json+protobuf`，body 为 `[[[text], fromLang, toLang], "te_lib"]`，结果读 `[0][0]`。附带包内固定 Google key，**本文不复制该 key**，其位置是后台 LF 8692；原包快照已保留。

HTTP 非 2xx 包装为 `Sa`。403、408、429、5xx，以及没有明确 status 的解析错误或直接 fetch 抛出的网络错误，允许尝试下一级；其他明确 status 直接抛出。页面侧经 `backgroundFetch` 时，后台 fetch 失败会返回 status=0，包装成带 status=0 的错误后不允许回退；消息发送本身抛错仍是无 status 错误。[后台 LF8694–8697、8776–8778、9051–9057](../../evidence/legacy/formatted/background.js#L8694)。第三层还受远程站点规则 `features.googleTranslatePaEnabled` 控制；规则拉取失败使用内置默认值，实际默认开关见根目录站点规则模块。

关键原代码（后台 LF 8805–8820，省略外层缩进，正文未改逻辑）：

```js
async function dw(e, t, a) { let n; try {
    return await BB(e, t, a);
}
catch (i) {
    if (!cw(i))
        throw i;
    n = i;
} try {
    return await UB(e, t, a);
}
catch (i) {
    if (!cw(i))
        throw i;
    n = i;
} const { googleTranslatePaEnabled: r } = await $F(); if (!r)
    throw new Error(`Google translation failed after GTX and clients5: ${(n == null ? void 0 : n.message) || String(n)}`); return await qB(e, t, a); }
```

### 3.2 Microsoft 的签名与响应

URL 参数：`api-version=3.0`、`to`、`includeSentenceLength=true`、`textType=html`；源语言非 auto 时加 `from`。body 为 `[{Text: text}]`，结果读取 `[0].translations[0].text`。

签名 `WB`：UUID 去横线、UTC 时间字符串、应用标识 `MSTranslatorAndroidApp` 和编码后的 `host+pathname+search` 拼接，整体转小写后用包内固定原始字节做 HMAC-SHA256，Base64 编码；header 形状为 `appId::signature::utcDate::nonce`，放入 `X-MT-Signature`。固定签名字节在后台 LF 8692，**不复制到新文档或新实现**。这只是包内既有协议恢复，不代表该非公开签名通路具有稳定性保证。

来源：[后台 LF 8834–8846](../../evidence/legacy/formatted/background.js#L8834)。

### 3.3 DeepLX 的协议与默认值矛盾

`pw` 读取 `provider.baseURL`；仅当 `provider.provider === "deepl"` 才取同一配置的 apiKey，将语言 `auto` 保留，其余转大写。POST JSON `{text,source_lang,target_lang}`；要求响应 `data` 是字符串。可走直接 fetch，或 `backgroundFetch` 的包装响应。

**需避免照搬**：默认 `ts.deepl.baseURL` 是 `https://api-free.deepl.com/v2/translate`，但此函数还追加 `/translate`；且这里的 JSON 和 `.data` 解析显然按 DeepLX 协议写的。安装包只能证明代码矛盾，无法证明用户自定义 URL 下是否成功。

来源：后台 LF 2702、8821–8833；[provider-transports.js](../../evidence/legacy/extracts/providers/provider-transports.js)。

### 3.4 AI SDK 和 URL 清理

`SB` 清理 key：trim 后移除非 ASCII 可见字符；baseURL trim、去尾 `/`，剥离 `/chat/completions`、`/responses`、`/completions` 等 endpoint 尾巴；没有版本段时通常补 `/v1`。Gemini 单独保留 v1beta。AiHubMix 域名被归一化到官方 v1 URL。

- OpenAI、DeepSeek、Gemini 有独立 SDK adapter。`co` 的默认 languageModel实际返回 `J2` responses模型（后台 LF8668–8669），而 `.chat` 返回chat模型。
- `custom` 的包装 `n` 将 languageModel/chat 都指向 `.chat(model)`。无 key 的注册阶段先用 `dummy-key` 占位，真正 `lw` 调用前会明确拒绝缺 key；自定义 URL 非 AiHubMix 时也必须填写。
- 自定义 URL 包含 `aihubmix` 时，`lw` 改调 `Mc(userPrompt,"auto","auto",model)`。这会将已生成的 userPrompt 当作待翻译文本再次包入 AiHubMix 的简单提示词；需要在兼容性测试中单列。
- `lw` 对 `gemini-2.5-pro-thinking` 和 `gemini-2.5-flash-thinking` 加 `google.thinkingConfig.thinkingBudget=128`。
- `lw` 调用 `$D({model,system,prompt,providerOptions})`。调用上下文虽携带 temperature，`jL` 构造普通 `aiTranslate` 任务时已将其丢弃，`gU.paramsMapper` 也仅传 provider/modelString/prompt，**该通路没有将配置 temperature 交给 generateText**；Coco 通路则确实传递 temperature。
- 普通翻译调用是非流式 generateText；Coco 显式 `stream:false`，AiHubMix 的 create 未设 stream。包中 SDK 的 `doStream`、tool call、embeddings、images、audio、files 等通用能力不构成本插件已使用的功能。

共享服务配置对话框 `Kp` 的测试是另一入口：它先将表单值写入主配置，再直接用 “Hello” 调用 `aiTranslate` 或 `cocoTranslate`；测试失败或随后取消对话框的路径未见回滚。它绕过上面的 `jL` 队列及专家/术语 Prompt 构造。[控件 LF1423–1451](../../evidence/legacy/formatted/chunks/DisplayModeSelector-aVEBmg_I.js#L1423)。一般设置 `Ky` 另有测试回调及不同的UI可见条件，不能把Kp的副作用推广到所有测试入口，详见 [06 §6](06-settings-and-configuration.md#6-设置页保存与特殊入口)。

错误提示映射：401/Unauthorized → key 无效；404 → 模型不存在；fetch failed/ENOTFOUND → 网络或 baseURL；baseURL → 未配置；AiHubMix 额外映射 429。SDK 自身存在重试（`OD` 默认 2 次；OpenAI 客户端默认 maxRetries 2），外层队列可能再重试，需核算乘法式请求放大。

来源：后台 LF 5359–5364、7393–7455、8671–8684、8714–8741、8847–8877、8980。

## 4. 提示词、专家与术语库

详见 [prompt-and-terms.js](../../evidence/legacy/extracts/providers/prompt-and-terms.js)，来源后台 LF 2556–2701。

### 4.1 专家并非复杂 URL 自动选择引擎

内置专家有 general、formal、casual、tech、academic、creative；当前 `WI(styleId)` 按 `ai.style` 从内置数组或自定义专家中查找。`RI` 从 `congcong_translate_expert_config` 读取、校验并缓存；旧专家的 systemPrompt 会迁移为 styleDescription。后台此副本未见专家存储 watch，首次读取后可能继续使用旧快照；页面侧 `Xbe` 也有独立缓存，见 [host LF1551–1564](../../evidence/legacy/formatted/content-scripts/host.js#L1551)。术语库另有 watch，不应混同。

`dh` 的实际分支：若能找到 style 对应专家，就用 `CI` 构建 system/user prompt；**此时不会采用 `aiTranslate.promptsConfig` 中选中的自定义模板**。只有找不到专家才走模板 fallback。专家配置 `enabled/selectedExpertId` 不是本函数的分支条件，不能仅凭 UI 文案断言它们直接控制此翻译入口。

专家 systemPrompt 要求仅输出译文、不用 Markdown、保留 HTML 标签；userPrompt 要求翻译成目标语言并附原文。常见 `builtin-general` 默认始终能找到，因此模板 fallback 到达条件要专门测试。页面侧 `host.js` 的 `cH`（LF1636起）与这里的 `dh` 同构，均先按 `ai.style` 查专家，再走模板fallback；不是后台和网页各一套不同的优先级。

### 4.2 术语库匹配

`BI` 从 `congcong_translate_termbase_config` 读取，schema 默认 `{enabled:true,libraries:[]}`。`HI` → `qI/$I` → `MI` 选择库：库 enabled 为 true，且 URL 命中其 matches；无 URL 时仅匹配含 `*` 的库。

域名规则支持 `*`、`*.example.com`（含根域）、普通域名（含子域）；完整 HTTP(S) 规则采用 URL 前缀；URL 解析失败才按字符串包含匹配。合并启用条目，重复 source 后出现项覆盖前项。

`ZI` 把 source 作转义后的大小写不敏感正则，只在原文中出现时附加术语行；target 为空表示保留 source。schema 没有 caseSensitive 字段，匹配也没有词边界。**这条 HI/MI 调用链没有检查顶层 termbase.enabled**，只检查库和条目 enabled。重构时要确认是否修正，而不是把 UI 开关自动当作代码事实。

### 4.3 上下文与占位符

原文含 `__CCPH\d+__` 时，追加“占位符必须原样保留”指令。contextEnhancement 开启时增加 Document Title 与 Source domain；URL 用于术语库规则匹配，即使未开启完整上下文也可能传 URL。

Coco 通过 `dh(...,{omitInput:true})` 避免把原文重复塞进 customPrompt，真实原文放 request.text；普通 AI 将原文放 userPrompt。

关键原代码（后台 LF 2654–2666）：

```js
async function dh(e, t, a, n) {
    var v, k, E, O, w;
    const i = /__CCPH\d+__/.test(t) ? "Preserve tokens matching __CCPH\\d+__ exactly; do not translate, remove, or alter them." : "", s = await _t();
    if (!s)
        throw new Error("No config when translate text");
    const o = n != null && n.omitInput ? "" : t, l = ((v = s.ai) == null ? void 0 : v.style) ?? "builtin-general", u = await WI(l);
    let c = {};
    try {
        const _ = a != null && a.url ? { url: a.url } : {};
        c = await HI(_);
    }
    catch { }
    const d = ZI(c, t);
```

模板 fallback 的变量是 `{{targetLang}}` 与 `{{input}}`，不是文案中可能出现的 `{{text}}`；逐一 replaceAll。默认模板强调保留 HTML 结构、只翻译文本。fallback 分支以固定英文首句正则插入术语和上下文；若自定义模板不匹配，二者静默不插入，虽然占位符保护仍会追加。[后台 LF2686–2699](../../evidence/legacy/formatted/background.js#L2686)。

## 5. 调度：实际为令牌桶，不是严格并发池

`jL` 为排队请求生成 SHA-256：`provider:fromLang:toLang:text`。**不含 model、temperature、prompt、术语库或 pageContext**，所以同文本同时切模型或提示词可能复用同一任务 promise。Google/Microsoft 正常入口绕过队列，但队列注册表仍允许其任务类型。

`pU` 组成：按 scheduleAt 排序的小顶堆、waitingTasks Map、executingTasks Map、令牌桶与定时器。同 hash 等待或执行中直接返回同 promise；初始令牌为 capacity。每秒按 rate 补充令牌，队首到时且令牌 ≥1 即派发。

初始化 `Nc` 将配置变换为：

```js
Ea = new pU({
  rate: t.maxConcurrent * 2,
  capacity: t.maxConcurrent * 3,
  timeoutMs: t.timeout,
  maxRetries: t.retryTimes,
  baseRetryDelayMs: hU
});
```

上段为后台 LF 8971–8972 原对象结构的换行排版，语义不变。默认 maxConcurrent=10，因此初始突发30任务、每秒20 token；**schedule 没有检查 executingTasks.size，不能称“最多并发10个”**。requestDelay 在这条调度链没有使用。

执行使用 `Promise.race([thunk(), timeoutPromise])`，超时拒绝但**没有 AbortController 取消实际网络请求**。非配额类失败按 `1000*2^(retryCount-1)` 加0–10%随机抖动重排；配额、会员、MODEL_NOT_IN_PLAN、NO_ACCESS 类错误不做队列重试。内容页 `vk` 另有 Coco 配额错误重试计数，每个 JS 上下文的模块级计数最多3次（不是每次请求各3次，且成功后未见重置）；它并未切换 provider 或 model，不能称为自动降级。

动态配置 `mU` 的字段为 rate/capacity/timeoutMs/maxRetries/baseRetryDelayMs，但 `setQueueOptions` 又用 `requestQueueConfigSchema.partial()` 校验，schema 主要字段是 maxConcurrent/requestDelay/retryTimes/timeout；这是另一处接口形状不一致，不能默认它可正确热更新所有字段。

来源：[queue.js](../../evidence/legacy/extracts/providers/queue.js)，后台 LF 8902–8980；`vk` 在 LF 7716–7728。

## 6. 缓存键、容量与生命周期

`HU` 通过 `qU` 使用 IndexedDB：数据库 `congcong-translate-cache`，版本2，对象仓库 `translationCache`，主键 key，索引 createdAt/lastUsed。版本2迁移为缺 lastUsed 的旧记录补 createdAt。后台 `Oq` 调用 `Rw` 注册 `proxy-service.CacheService`；`Ew` 在页面侧用 Proxy 把方法路径与参数通过扩展消息发给后台，在后台侧取已注册实例（后台 LF9141–9144、9698）。该接口不等同于把缓存数据库复制到每个页面。

文本入口仅在 `cache.enabled && AI开启` 时读写，普通 Google/Microsoft 不经此缓存。调用者构造 providerConfig 包含 provider、model、temperature、style，language 包含最终源/目标语言；缓存读取最多等待1秒，超时不阻塞翻译；成功非空译文异步写缓存。

`generateCacheKey` 对 providerConfig/metadata 递归按键排序序列化，与 text、最终 sourceCode、targetCode、metadata 字符串以 `|` 连接后 SHA-256。source 选择顺序 sourceCode → systemCode → detectedCode → auto。当前文本调用者没有把完整模板、术语版本、URL、上下文塞进 metadata，因而这些变化不会自然使旧译文失效。所核对的HU方法未提供按URL清理，现有记录结构也没有URL字段；不能声称已支持按网站清缓存。

初始化失败时 `HU._initializing` 保留已完成的 promise，之后同一实例再次调用 `ensureReady` 只等待它并返回 false，不会重新调用初始化；实例重建后的情况未实测。[后台 LF9245–9253](../../evidence/legacy/formatted/background.js#L9245)。

记录结构：`{key,translation,createdAt:Date,lastUsed:Date}`。命中更新 lastUsed；容量 `maxSize` 单位是 **MiB**，估算 key字节+译文字节+8，不是 schema 名字所暗示的条数。超限按 lastUsed 从旧到新删除。TTL 单位天，初始化时后台清理及显式 cleanupExpired 会删除旧 createdAt 记录；`get` 本身不检查过期时间，ttl=0关闭过期删除，maxSize<=0不强制容量删除。

来源：[cache.js](../../evidence/legacy/extracts/providers/cache.js)，后台 LF 9217–9329；文本调用读写 LF 7745–7765、7791–7815。

## 7. 错误、消息及边界

| 消息/函数 | 输入 | 输出/错误 |
| --- | --- | --- |
| `enqueueRequest` | `{type,params,hash?,scheduleAt?}` | 任务结果；未知 type 抛错 |
| `backgroundFetch` | `{url,method,headers:[k,v][],body,credentials}` | `{status,statusText,body}`；网络失败返回 status=0，不直接 throw |
| `translateSubtitle` | `{text,fromLang?,toLang?}` | `{text,provider}`；失败变成 text=“翻译服务出错”并附 error |
| `translateReadingArticleChunk` | `{items,prompt,toLang,videoTitle,videoAuthor}` | `{items,provider,model}`；失败 items=[] 并附 error |
| 文本入口 DL/$L | text + config/覆盖语言 | string；失败仍抛出且调用 Up 上报诊断 |

`ci` 以 `typeof document === "undefined"` 判定后台；后台直接 fetch，否则发送 backgroundFetch。它返回文本状态对象，不直接以 HTTP 状态 throw，适配器负责检查。后台通用 fetch 为自有 API 自动追加 X-App-Id/X-App-Version，其余 URL 不加这些头。

翻译失败通过 `Up` 进入已有错误上报逻辑，包含 reasonType/provider/source/错误名/stack/sourceTextLength；详见根模块的诊断与反馈说明。重构不应默认原文永远不出现在错误消息或第三方SDK异常里。

## 8. 分批重构技术方案（建议，不是旧代码）

### P1 · 普通翻译与统一契约

先定义 `TranslationRequest{text,sourceLanguage,targetLanguage,signal}` 与 `TranslationResult{text,provider,detectedLanguage?}`，只实现一条明确可维护的普通翻译服务。将 provider 支持列表由真正 adapter 注册表生成；Baidu/Youdao 等未实现项不显示为可选。网络放后台，校验消息与目标域名；错误使用稳定 code，页面不插入错误文案作为真实译文。

### P2 · 可取消调度

明确区分 `maxConcurrent`、rate、burst、requestDelay。并发池按实际执行数限制，token bucket只负责速率；超时/用户关闭时 abort fetch。统一外层重试预算，避免 SDK 与队列叠加。任务 key 应覆盖 provider/model/语言/提示词版本/术语版本/上下文影响项，明确取消和同任务多订阅者的关系。

### P3 · 自定义 AI 与提示词

实现 OpenAI兼容、Gemini 两类传输，以配置选择 protocol，而不是根据 URL 字符串猜 provider。显式传 temperature。把“专家风格”和“模板选择”组合规则写成确定优先级；统一模板变量；占位符先校验后恢复。尊重 termbase总开关，增加大小写与词边界策略的明确选择。

### P4 · 缓存

缓存键覆盖所有影响结果的输入，读时检查 expiry；容量按字节实现LRU。缓存失败降级为无缓存，不能导致页面翻译失败。提供清理与命中统计。保留新旧 schema迁移适配，不将旧key直接当新协议。

### P5 · Coco/账户与附加通路

仅在确定继续使用旧后端及协议后接入，先完成 [07](07-account-and-backend.md) 的账户与契约。Google包内固定key、Microsoft固定签名字节不作为新工程内置依赖。DeepLX与官方DeepL分成不同协议，不复制有矛盾的URL拼接。

## 9. 验收用例

1. 普通/AI开关切换，确认请求到达选中adapter；未知provider报稳定错误。
2. 文本含HTML与占位符，tag/token原样保留；仅占位符结果不进入DOM。
3. 同文不同model/temperature/prompt/术语库产生独立任务和缓存；同完整请求共享in-flight结果。
4. 中文简繁、短文本、源目标一致、固定源语言和字幕覆盖语言分别测试。
5. 403/408/429/500触发Google回退，400/401不盲目回退；关闭第三层开关不调用第三端点。
6. 队列超时实际abort网络；取消后不会再次渲染；错误重试次数与SDK重试合计受控。
7. 明确测突发和同时执行数，避免把令牌桶误作并发上限。
8. 缓存超时/IDB失败不阻断请求；TTL过期读取即miss；LRU按字节清理。
9. 自定义URL误填完整endpoint、中文空格混入key、缺key、404模型、401鉴权得到准确反馈。
10. 不调用外部服务的夹具测试覆盖各供应商已知响应形状及畸形/空响应；真实服务集成测试单独授权配置。

## 10. 未知与待决策

- 没有原始TS、依赖锁文件、服务端源码，无法保证原开发结构或模型接口现状。
- 包内不同chunk包含业务副本，通用SDK代码量远大于业务实现；不要原封不动迁入新工程。
- 本文恢复现有函数，不保证所有枚举、schema、UI项均有有效执行路径。
- 需要决定哪些旧缺陷属于兼容行为，哪些要修正：DeepLX默认URL、温度未传、缓存/去重键不全、术语总开关、并发命名及重试叠加。
