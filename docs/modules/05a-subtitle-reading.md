# 05a 字幕阅读与文章模式

[返回视频字幕模块](05-video-subtitles.md) · [返回文档索引](../README.md)

## 1. 能力边界与入口

这是 YouTube 已获取字幕的另一种阅读界面，不是网页正文阅读器，也不负责从视频音频生成ASR。快速菜单`reading-mode` → `open-subtitle-reading-mode` → `k3.openSubtitleReadingMode()`，暂停视频后创建`g4`。输入是controller.currentSubtitles、当前播放时间、视频标题/作者、语言作用域和回调。源码：[video-subtitle.js L10263–10293](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10263)。

静态确认的功能包括：字幕列表/文章布局、原文/仅译文/双语展示、逐句翻译、文章分块改写、修改提示词重新翻译、播放位置跳转、播放器在阅读界面显示/隐藏和重新布局、导出源字幕。中文文章默认提示词是“帮我把这段 youtube 的采访字幕，翻译成对话文本的格式，保留核心表达，但是要让对话是非常流畅的”，不是简单逐字翻译。[L1083](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L1083)

本模块仅做静态恢复；没有对旧服务器发请求，没有把文案当成实时可用性的保证。

字幕专用 bundle 中 `TTS_SPEAK` / `TTS_STOP` 仅为动作枚举，阅读面板及本模块入口未见调用或朗读按钮；因此已审查的字幕阅读路径没有专用 TTS。划词弹窗的 TTS 属于另一条 host 链路，不能据此推断字幕朗读可用；也不排除第三方库含其他语音代码。参见 [交叉核查](../../evidence/legacy/cross-validation/video-comparison.md)。

## 2. 结构与数据流

```text
快速菜单
  → k3.openSubtitleReadingMode
      → M3.pauseVideo
      → g4.open → React布局 r4
          ├─ subtitle layout → scheduleTranslation → translateSubtitleForReading
          │    → background translateSubtitle → 全局翻译服务
          └─ article layout → buildArticleChunks → translateReadingArticleChunk
               → background translateReadingArticleChunk → uw（Coco文章服务）
```

`g4` 的状态和构造器位于 [L9310–9321](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9310)。状态划分：

- UI：layoutMode横/纵、contentLayoutMode字幕/文章、displayMode、activeSubtitleIndex、isVideoVisible。
- 字幕翻译：sentenceMetas、pendingQueue、runningCount、translationCache。
- 文章翻译：articleTranslationVersion、articleChunkQueue、articleChunkStatus、articleLineStatus、articleTranslationCache、articlePrompt。
- DOM资源：overlay、list、observer、React root、播放器原parent/nextSibling/placeholder、ResizeObserver和RAF。

每条sentence meta关联原cue，通过`ki(cue)`生成 `${start}|${end}|${text.trim()}` 身份。文章回包更新前校验版本号和destroyed，逐句回包也检查当前位置cue身份，避免旧布局内容被后到结果覆盖。[L9304](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9304)、[L9580](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9580)

## 3. 打开、播放与关闭

`open()` 创建`#congcong-subtitle-reading-mask`（cc-notranslate），内部React root；点击遮罩关闭，内层阻止冒泡，Escape绑定关闭。播放器可移动到阅读布局的playerHostElement，保存原parent/nextSibling并放placeholder；隐藏播放器时暂停，恢复到原位置。ResizeObserver与RAF根据布局大小更新播放器尺寸。`destroy()` 移除观察器、队列和定时器、Escape、React根、遮罩，并恢复移走的播放器。[L9322–9328](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9322)

单击字幕行走`seekToSubtitleAndPlay`，设置video.currentTime=max(0,start)并play；其Promise失败被吞掉，不应向用户展示已保证播放成功。关闭阅读模式不等于恢复到打开前的播放/暂停状态。

标题/作者先读`window.ytInitialPlayerResponse.videoDetails`，没有时读YouTube DOM。内容世界未必可直接读取页面自有全局，DOM是实际fallback；元数据准确性需要浏览器验证。[L10265](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10265)

## 4. 字幕模式翻译调度

`openSubtitleReadingMode`传入`translationMode:'continuous-batch'`。g4另保留viewport模式：IntersectionObserver以列表为root、rootMargin=`2000px 0px`、threshold=0.1，接近可见区域时翻译；本入口实际选择的是连续批处理。[L9458–9470](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9458)

实际连续调度参数在构造器 [L9311](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9311)：

| 参数 | 值 | 含义 |
| --- | --- | --- |
| maxConcurrentTranslations | 3 | 同时逐句翻译数 |
| continuousBatchSize | 8 | 每次tick最多安排8句 |
| continuousBatchTickMs | 120 | 每120ms继续调度 |
| maxContinuousInflightTranslations | 12 | running+pending合计上限 |

顺序从当前活动句开始向前遍历到0，再翻当前位置之后。每个meta由idle→loading→done/error，重复文本用translationCache（key=text.trim）复用。[L9538–9592](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9538)

核心原代码：

```js
buildContinuousBatchOrder() {
    const t = this.sentenceMetas.length;
    if (!t) return [];
    const n = this.activeSubtitleIndex >= 0 && this.activeSubtitleIndex < t
        ? this.activeSubtitleIndex : 0, r = [];
    for (let a = n; a >= 0; a -= 1) r.push(a);
    for (let a = n + 1; a < t; a += 1) r.push(a);
    return r;
}
```

出处：[L9561–9565](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9561)。原压缩符号保留，代码只增加换行排版。

逐句回调读取cue.text.trim，调用后台translateSubtitle，传controller解析出的fromLang/toLang；响应为空或等于原文时返回空串，阅读UI不重复展示相同文本。异常被转换为空串；这会把部分服务失败表现成“没有译文”，重构应显式区分失败和同文。[L10276–10286](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10276)

## 5. 文章分块、响应校验与回退

### 5.1 分块输入与并发

每50个sentenceMetas构成一块，空文本跳过。每项`{index,timestamp,text}`；chunk key是timestamp按`|`连接。请求数据：

```ts
// 概念形状，从调用与校验恢复，并非原TS类型。
{
  items: Array<{ index: number; timestamp: string; text: string }>;
  prompt: string;
  fromLang?: string;
  toLang?: string;
  videoTitle?: string;
  videoAuthor?: string;
}
```

文章最大并发2。设置chunk及对应line为loading，依次drain；每块最多请求3轮，返回非登录error或校验失败时继续；抛异常则直接进入fallback，登录错误则标记失败并提示登录。尝试耗尽后逐句串行调用普通字幕翻译fallback。[L9467–9537](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9467)

### 5.2 回包必须保持句数和timestamp顺序

`vP()`使用schema要求`{items:[{timestamp:非空字符串,text:字符串}]}`，验证items数量、每项timestamp与请求逐位置一致，并拒绝所有text都空；允许部分项目空字符串。[L1085–1090](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L1085)

原关键逻辑：

```js
if (r.length !== e.length)
    return { success: !1, reason: `item length mismatch: expected ${e.length}, received ${r.length}` };
const a = e.map(l => l.timestamp), i = r.map(l => l.timestamp);
for (let l = 0; l < a.length; l += 1)
    if (a[l] !== i[l])
        return { success: !1, reason: `timestamp mismatch at index ${l}` };
```

响应校验不能在迁移时省略，否则文章模型合并/拆分句子会让字幕跳转错位。

### 5.3 后台服务边界和登录

controller将language override/title/author传给后台；background handler调用`uw({items,prompt,toLang,videoTitle,videoAuthor})`，没有继续传fromLang。失败返回`{items:[],provider:'coco',model:'deepseek-v4-flash',error:序列化错误}`。**文章模式使用专用Coco逻辑，不等同于用户当前选择的普通字幕引擎**。具体API/鉴权见账户与后端模块。[background L9065–9071](../../evidence/legacy/formatted/background.js#L9065)

错误消息包含“请先登录椰子翻译账号”或“登录已过期”时，标记chunk/line error，并且每次阅读会话最多弹一次confirm，引导后台openUrl(`/login.html`)，失败fallback window.open。普通非登录失败则尝试fallback。登录错误的字符串匹配很脆弱，重构建议用结构化error code。[L9490–9520](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9490)

## 6. 提示词版本与文章缓存

`getArticleCacheStorageKey`将videoTitle、videoAuthor、articleCacheScope（from|to）、prompt拼接后经过`d4`散列，再加`o4`前缀存sessionStorage。值是按cue身份映射译文。缓存不直接包含videoId，存在同标题/作者/语言/提示词视频互相污染的风险；同一页面session结束前保留。[L9329–9350](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9329)

改提示词时：清旧prompt与新prompt缓存、articleTranslationVersion++、清内存cache/status/queue，再恢复可用缓存、重绘布局与句子。旧请求结果仅在version一致且未destroy时写回。它是**忽略过时结果**，不是取消已经发生的后端请求，配额可能仍被消耗。[L9311](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9311)

文章翻译成功写cache并persist，最后每句进入done；提示词只影响文章模式，不改变普通字幕逐句翻译参数。exportSource回调始终下载源字幕SRT。

## 7. 重构建议与验收

建议拆为`ReadingSession`、`SubtitleTranslationQueue`、`ArticleChunkQueue`、`ReadingView`与`PlayerHost`；复用视频Cue和后台翻译服务，但不要把普通字幕队列与文章改写的输出契约混在一起。

建议按以下顺序实现：

1. 本地已加载cue的只读列表、时间跳转、源字幕导出，播放器先保持原DOM位置。
2. 可取消的逐句队列、3并发/12inflight基线，明确loading/error/同文状态。
3. 文章50句分块、2并发、严格timestamp校验，先用fixture服务验证。
4. 接入账户/后端与登录错误；把错误码从文案中分离。
5. 提示词版本与缓存，key改为videoId+cue身份+语言+引擎/model+prompt版本。
6. 可选播放器移动、横纵布局、隐藏/恢复与ResizeObserver清理。

验收用例：

- 0句、1句、超过50/100句，空句、重复text和重复timestamp。
- 回包缺句、多句、timestamp乱序、全部为空、部分为空、登录失败/超时。
- 翻译中切prompt/语言/布局、快速关开阅读界面、SPA切视频，确认旧回包不会写到新会话。
- 逐句同文/空返回不被误判为成功翻译；失败可以重试。
- 播放器显示/隐藏/关闭后回原位置，原nextSibling已被站点移除也不抛错。
- Escape/点击遮罩/关闭按钮都清观察器、队列、样式与播放器占位。

保留的未知：文章模型实际可用性、服务器如何扣费、title/author散列算法的碰撞概率、真实YouTube播放器搬动后的稳定性。上述均未通过真实站点或旧服务验证。
