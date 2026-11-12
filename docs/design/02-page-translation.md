# 02 · 网页翻译管线、显示与站点适配

本文是待实施方案。页面翻译负责从当前文档提取可翻译内容、调度请求、可逆渲染及持续跟踪变化；翻译服务由 [01](01-translation-core.md) 提供，配置由 [08](08-configuration-and-ui.md) 提供，消息与平台能力分别遵循 [13](13-protocols-and-data.md)、[11](11-browser-platform.md)。交互入口见 [03](03-interactions.md)，分享使用独立快照，见 [04](04-capture-and-sharing.md)。

## 接口与状态

以下为语义接口，具体消息字段以模块 13 为准：

```ts
type PageSession = { sessionId: string; generation: number; active: boolean; signal: AbortSignal }
type Block = { id: string; root: Node; sourceText: string; placeholders: Map<string, Node>; sourceDigest: string; forceReplace: boolean }
type RenderDecision = { showTranslation: boolean; hideOriginal: boolean; replaceOriginal: boolean; variant: 'bilingual' | 'replace' | 'short-original' }
type PageStatus = { active: boolean; scanning: boolean; queued: number; running: number; failed: number }
interface PageTranslator {
  start(): Promise<void>; stop(): Promise<void>; revalidate(): Promise<void>;
  status(): PageStatus; dispose(): Promise<void>
}
```

每个 Document/frame 的页面会话使用模块 13 的 sessionId/generation；跨文档导航使旧session失效，新文档创建新session；同文档SPA重扫、停止或销毁递增该功能generation并abort。所有块请求继承页面会话标识。requestId 标识单次请求；sourceDigest 标识块源文快照。仅当 sessionId、generation、节点连接状态和源文摘要均匹配时允许回填。`active` 表示模式开启，队列清空仅表示当前已发现工作完成，不能保证未来懒加载内容已译完。

Block的Map保存原节点引用，仅存在内容脚本。传输时按模块13构造可序列化TextUnit，placeholder值为允许传输的字符串表示；回包通过本地Map安全重建节点，DOM Node不进入扩展消息。

## 处理流程

1. 根据 URL、语言及站点禁止/自动规则决定是否启动；显式操作与自动规则分别记录，禁止规则优先。语言检测先用文档声明再回退文本；旧中文识别对汉字占有效字符至少 10% 的文本有偏置，混合日文需测试。
2. `main` 范围依次选 `main[role=main]`、`main#main-content`、`main`、`[role=main]`、`article[role=main]`、`article`，否则 body；Stripe、TikTok 使用 body。迭代遍历避免深层递归，将连续行内节点分组，块节点和 iframe 划分边界。
3. 排除脚本、样式、代码、媒体、图片、数学公式、表单及 editable、`translate=no/false`、不翻译标记和隐藏节点；过滤数字、URL、邮箱、路径、哈希等非语言内容。导航兄弟文本可合并判断。
4. 默认 `minLength=10, minWordCount=2, maxLength=5000`：长度达下限 **或** 词数达下限即可；超过上限跳过，长度上限不意味着自动切段。站点显式 include 可绕过常规长度过滤。
5. 默认懒翻译，初始预算 4999 有效字符，保留内部空白；仅完整段落放得下才立即入队，短文本原文模式不消耗预算。其余候选以 IntersectionObserver `rootMargin: 1000px` 观察，进入范围后重新过滤；移除节点注销观察。全量模式直接排队。遍历并发、页面翻译并发及后台网络队列分别控制，旧参考值为 10、30 和服务层独立限制。
6. 提取文本与行内 HTML/代码占位符，整体块换行使用 `__CCPHn__`。请求模块 01 保留占位符；返回后验证占位符集合、顺序与结构，不能安全恢复则保留原文并报告块错误。只允许安全标签和属性，校验 URL 协议，不将模型输出作为可信 HTML。
7. 根据显示策略决定双语、替换或混合；混合默认阈值 15，短文本保留原文，站点可强制替换。行内/换行由布局与 forceInline/forceBlock 决定。显示样式支持配置中的 19 个枚举，包含下划线、边框、高亮、marker 等；枚举以 [样式枚举](reference/legacy-enums.json) 为基线，默认值见 [默认配置](reference/legacy-default-config.json)，未知值回退默认样式。

```text
decide(mode, length, threshold, shortMode, forceReplace):
  if forceReplace or mode == replace: return replace
  if mode == bilingual: return bilingual
  if mode == mixed and length <= threshold:
    return short-original if shortMode == original else replace
  return bilingual

run(block, session):
  if stale(session) or !eligible(block): return
  sourceText, placeholders, sourceDigest = snapshot(block)
  result = await translate(sourceText, signal=session.signal)
  if stale(session) or !connected(block) or currentDigest(block) != sourceDigest: return
  if !validPlaceholders(result, placeholders): recordError(block); return
  restore = renderSafely(block, result, decision(block))
  session.restorers.add(restore)
```

记录每项原 display、原位文本/属性、wrapper、clone 和站点修改；恢复仅撤销本会话拥有的修改，并避免覆盖页面后来修改的内容。停止先失效并取消队列、断开观察器及监听，等待任务收尾，再执行恢复和 adapter teardown；网络不支持中止时仍丢弃迟到成功及失败。销毁幂等。

## 动态内容与站点

MutationObserver 处理 childList、subtree、characterData，属性仅观察规则声明的 translateAttributes；变更使相应块版本失效并重扫。新节点发现 open ShadowRoot 和同源 iframe；跨源 frame 由各自注入的实例处理，通过模块 13 的可信通道按 tab/frame 身份同步，校验来源与消息，禁止双重扫描。同源 frame 导航也要换代。closed shadow 和不可访问 frame 明确跳过。

SPA 的 history、导航事件及必要的 500ms URL 轮询统一去抖，换代、恢复旧 DOM、等页面稳定后重新加载规则；停止时还原 hook 并清理监听。站点 adapter 可覆盖通用导航策略，避免重复监听。规则快照按 session 固定；更新仅在下一轮生效。

完整 10 站规则及 feature 见 [站点规则基线](reference/legacy-site-rules.json)：Google、GitHub、Instagram、LinkedIn、Reddit、Telegram、TikTok、X/Twitter、YouTube、WhatsApp。各 adapter 读取完整规则快照，并各自登记和撤销 DOM 修改：

| 站点 | 适配职责 |
| --- | --- |
| Google | 排除符号和图标；feature 交服务层处理，旧 PA 开关只影响前两条路径失败后的回退 |
| GitHub | 排除 diff、仓库导航及元数据；单独允许 About 描述，并观察侧栏变化 |
| Instagram | 保留账号和标签，处理 profile header、图片 alt/overlay，恢复原 HTML 和样式 |
| LinkedIn | 组织简介 whole/replace，排除省略和页脚 |
| Reddit | 排除作者、时间、flair 和操作区，强制块边界 |
| Telegram | 排除左侧导航 |
| TikTok | 处理 bio、评论与标题；字幕走独立模块 |
| X/Twitter | tweetText 整体处理，链接行内，排除身份和元信息 |
| YouTube | 标题、评论、chips 规则；管理导航、描述展开和全屏，字幕走独立模块 |
| WhatsApp | 排除侧栏和联系人区域 |

旧通用 SPA 监听跳过 x.com、twitter.com、github.com 及子域，不能据此推断这些站点没有专属监听。新方案由 adapter 显式声明导航事件与通用监听是否启用，并去重、换代和 teardown；各站点 fixture 验证一次导航只产生一轮扫描。旧远程规则 5 秒超时后回退，但 handler 在异步规则返回前捕获旧对象，YouTube 还复制了规则，不能认定远端选择器生效；feature 在等待后读取。新设计先验证完整规则快照再创建 handler，失败回退内置版本，不依赖历史签名 URL。

## 验收

- OR 阈值、超长跳过、include 例外、4999 边界和 IO 重入均有固定 DOM fixture；富文本/链接/恶意 URL、缺失或重复占位符不破坏源文。
- 三种模式、全部 19 种样式、属性和原位替换均可启停恢复；页面修改与迟到成功/失败不得被旧轮次覆盖。
- 动态文本、移除节点、SPA 多次导航、同源/跨源 frame、open shadow、取消和销毁后无遗留监听或旧译文；10 站各有独立规则 fixture。真实网站和远程规则有效性仍需实施后验证。
