# 05 视频字幕：YouTube 捕获、时间轴、翻译与渲染

[返回文档索引](../README.md) · [字幕阅读与文章模式](05a-subtitle-reading.md) · [TikTok 字幕面板](05b-tiktok-captions.md)

## 1. 范围与证据等级

本模块恢复旧包 `1.0.109` 的视频实现。**插件有两条独立视频链路**：YouTube 使用独立 content script + 页面世界注入脚本 + 视频覆盖字幕；TikTok 使用全站 `host.js` 的站点处理器 + 字幕列表面板。二者不是同一个控制器。

本文为 YouTube 静态实现复核；本地对抽取的纯函数做了 14 项行为探针，没有连接 YouTube、TikTok 或旧翻译后端。网页选择器、字幕签名、播放器私有 API 在当前线上是否仍可用，尚未运行验证。压缩符号保留为原名；下文语义称呼为分析命名，不是找回的 TypeScript 源文件名。

| 结论 | 等级 | 证据 |
| --- | --- | --- |
| YouTube 专用字幕链路可从 manifest 进入 | 静态已确认 | `manifest.json` 的第二项 content_scripts；[入口 L14919–14932](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L14919) |
| `/watch`、`/embed`、`/shorts` 有 ID 提取和播放器规则 | 静态已确认 | [ID 规则 L998 起](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L998)、[inject L227](../../evidence/legacy/formatted/video-subtitle-inject.js#L227) |
| Netflix、Udemy、Disney+、Hulu 在专用链路中只是残留检测/ID 规则 | 静态已确认的边界 | content script 匹配和入口守卫限制 YouTube；处理器 `MD={youtube:bC}` 位于 [L2229](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L2229)，quickButton 规则 `o$` 也只有 youtube |
| `youtu.be`、`youtube-nocookie.com` 被函数识别 | 仅检测分支 | manifest 并未给这些域名声明专用 content script，不能据此声称完整支持 |
| 非 YouTube 视频可通过 TikTok 处理器提取字幕 | 静态已确认 | 另见 [TikTok 文档](05b-tiktok-captions.md) |
| YouTube ASR 选轨、JSON3 解析和缓存行为 | 已执行局部逻辑 | [probe-results.json](../../evidence/legacy/extracts/video/probe-results.json) |

## 2. 文件职责与入口顺序

| 原构建文件/符号 | 职责 | 可读源码定位 |
| --- | --- | --- |
| `video-subtitle.js`，`rY.main` | 排除受限页面、读配置、一次性标记、注入页面脚本 | [L14919](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L14919) |
| `nY` | 内容世界总控制器：视频 ID 监听、广告监听、快速按钮和字幕控制器 | [L14902](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L14902) |
| `z3` → `k3` | 字幕状态、捕获结果、翻译调度、渲染、清理 | [L10197](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10197)、[L10471](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10471) |
| 页面脚本 `It` → `gt`/`h`，`V` | 页面私有播放器 API 与 fetch/XHR 拦截 | [inject L95](../../evidence/legacy/formatted/video-subtitle-inject.js#L95)、[L343](../../evidence/legacy/formatted/video-subtitle-inject.js#L343) |
| `p4` | 通过 bridge 请求字幕轨道和 JSON3 | [L9594](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9594) |
| `mC`、`bC` | 通用格式解析及 YouTube JSON3 归一化 | [L1955](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L1955)、[L2122](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L2122) |
| `iD` | 时间轴游标、二分检索、待翻译窗口 | [L1919](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L1919) |
| `M3`、`A3`、`O3` | Shadow DOM 字幕 UI、播放器事件、拖拽和样式 | [L9993](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9993)、[L10123](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10123) |
| `tY`、`eY` | 快速菜单、设置浮层、字幕可用性检测 | [L14779](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L14779)、[L14827](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L14827) |

实际启动顺序：

1. `rY.main` 执行 `getConfig`；若 `generalRule['subtitleRule.add'].disabled` 或 DOM 已有 `data-video-subtitle-content-loaded` 则退出。
2. 先写已加载标记，再 `IN('/video-subtitle-inject.js', {keepInDom:true})` 将页面脚本插入 MAIN world。注入失败可能留下该标记；beforeunload 清理监听只在注入成功后注册，因此失败时不能依赖该监听清除。
3. 页面脚本创建 `It`，构造器中即建立 bridge 和网络 hook。`waitReady(5000)` 最多等待 5 秒，返回 false 也仍会调用 initialize。
4. 内容世界创建 `nY`；等 DOM ready 后创建广告监测、字幕控制器 `z3` 和快速按钮 `tY`，再发 `contentReady`。
5. `k3.initialize` 挂载播放器容器、初始化渲染器/CC 观察器、请求 inject 中的现有字幕；未找到播放器容器时每 500ms 重试，最多 20 次。
6. beforeunload 分别销毁内容控制器和页面脚本的显式监听。旧脚本不是用一个统一 AbortController 管理所有自建资源，详见清理边界。

## 3. 跨世界消息协议

[bridge 原实现 L159–169](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L159)，[页面世界副本 L7–16](../../evidence/legacy/formatted/video-subtitle-inject.js#L7)。

```js
// 原实现的消息形状，字段来自 sendMessages / sendAsyncMessages。
{ eventType: 'congcong-subtitle-inject',
  to: 'inject', from: 'content-script',
  type: 'requestYoutubeCaptions', data: { /* 下表 */ },
  id: 123, isAsync: true }
```

`pr` 是 content-script → content-script 的同页广播，`Aa` 是 content-script → inject，inject 的 `p` 方向反转。异步消息用随机数 id 关联，默认 10 秒；超时 resolve(null)，并非 reject。监听条件只比较 `eventType`、`to`、`id/type`，没有 `event.source===window`、origin 校验或结构校验；页面脚本可构造同命名空间消息。重构时必须保留跨世界隔离边界，并重新定义可允许的消息白名单，不能把页面消息直接当可信后台调用。

| type | 方向与数据 | 行为/响应 |
| --- | --- | --- |
| `isContentReady` / `contentReady` | inject ↔ content | 初始化握手；内容端 `lm` 轮询就绪后回消息 |
| `isSubtitleTranslatorContentReady` / `subtitleTranslatorReady` | inject ↔ content | 自动开启或控制器已初始化时就绪；inject 缓存布尔 `I` |
| `autoEnableSubtitle` | inject → content，`{}` | 返回归一化后的 autoEnableSubtitle |
| `requestYoutubeCaptions` | content → inject，`{from,to,priorityHumanSubtitle,sourceLang,targetLang}`，15s | `{source:{url,responseText,languageCode,kind,vssId}, meta:{videoId,sourceLanguageCode,shouldSkipTranslation}}` 或 `{error}` |
| `requestYoutubeCaptionLanguages` | content → inject，`{}`，UI超时6s | 排除 CC 标记、同语言 ASR 优先去重的轨道数组 |
| `requestSubtitle` | inject → content，`{url,responseText}`；泛化分支还有 fetchInfo | 被动截获的字幕响应交给 k3.handleRequestSubtitle；并非翻译后台消息 |
| `triggerSubtitle` | content → inject，`{force}` | 点击原生 CC；force 时若已启用，关闭再 100ms 后打开 |
| `update-subtitleRule-config` | content 内广播，`{key,value}` | 临时开启、样式同步、语言更改触发重载 |
| `videoIdChanged` / `adStatusChanged` | content 内广播 | 视频切换重置状态；广告时隐藏覆盖层 |
| `download-subtitles` / `open-subtitle-reading-mode` | 快速菜单 → k3 | 源字幕 SRT 导出、阅读界面 |

常量表还列出 enable/disable 等名称，**有常量不代表存在对应处理器**。实际订阅集中于 `$3.bind`、`nY.registerMessageHandlers` 和 inject `It.setupMessageHandlers`，定位分别为 [L10190](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10190)、[L14905](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L14905)、[inject L349](../../evidence/legacy/formatted/video-subtitle-inject.js#L349)。

后台扩展消息另有：

- `translateSubtitle`: `{text,fromLang?,toLang?}` → `{text,provider,error?}`。若传任一语言覆盖项则调用 `$L`，否则 `DL`；服务选择继承全局 aiTranslate/provider，见 [background L9060](../../evidence/legacy/formatted/background.js#L9060)。
- `getSubtitlePosition` / `setSubtitlePosition`: 读写 storage.local 的 `subtitlePosition`，默认 `{top:'unset',bottom:0.3136507936507936}`，见 [background L2894](../../evidence/legacy/formatted/background.js#L2894)。
- `translateReadingArticleChunk`: 阅读文章模式专用，见子文档。

## 4. 页面世界捕获与请求恢复

### 4.1 两条 hook 路径

`V.hookRequest` 先运行一次 `hookYoutubeContext`，它同时包装 `XMLHttpRequest.open/send` 与全局 `fetch`，观察成功的 `/youtubei/v1/player` 和 `/api/timedtext` 响应。fetch 使用 clone().text()，尽量不消费播放器原响应；XHR load 中只读取 text/json 支持的 responseType。

另外按规则 `hookType:'xhr_response'` 再包装 XHR，匹配 `(/api/timedtext|videoplayback\?expire.*text)`，响应 200 且内容端已 ready 时送 requestSubtitle，429 调用 subtitleRequestError。此包装把 `onreadystatechange` 赋值成新函数，存在覆盖原处理器的兼容风险。[inject L95–107](../../evidence/legacy/formatted/video-subtitle-inject.js#L95)

规则名中不含 fetch，因而**通用“fetch 返回翻译后的 Response”分支没有被当前 YouTube 规则启用**。但第一条 context hook 仍然观察 fetch 的 player/timedtext 返回。`gt.isOnlyResponse` 对直播视频返回 false，因此直播可能走改写 XHR response 的泛化分支；在 content 侧 requestSubtitle 处理器主要更新本地列表，未返回替换 body，不能据此断言直播响应替换可以工作。

### 4.2 两层缓存

[inject L51–94](../../evidence/legacy/formatted/video-subtitle-inject.js#L51)：

| 缓存 | key/上限/期限 | 更新规则 |
| --- | --- | --- |
| `b: Map`，player response | videoId；64条；无TTL | `ytInitialPlayerResponse`/播放器读数 tier=2，网络 player 响应 tier=3；更高 tier 覆盖，但若新对象无 captionTracks，则保留旧轨道。相同/较低 tier 仅补齐缺失轨道 |
| `C: Map`，timedtext body | `v|lang(lowercase)|kind|tlang`；256条；5分钟 | 只缓存 JSON parse 成功且 events 中至少有一个对象的响应；过期访问删除；超过上限按 Map 插入顺序删除最早项，并非每次读取刷新LRU |
| `T.timedTextUrls` | videoId → 最新 URL 优先数组 | 收集完整已观察请求，供恢复参数；该数组未见容量或TTL限制 |

原高 tier 保轨道逻辑核心：

```js
if (t > o.tier) {
    b.set(n, { response: G(e, o.response), tier: t }), _(b, B);
    return;
}
```

出处：[inject L64–66](../../evidence/legacy/formatted/video-subtitle-inject.js#L64)。完整函数已保存在 [selected-declarations.js](../../evidence/legacy/extracts/video/selected-declarations.js)，原文件范围见 [source-index.json](../../evidence/legacy/extracts/video/source-index.json)。

### 4.3 获取播放器上下文、字幕轨道及参数

`J()` 最多 20×50ms 尝试：播放器 `getPlayerResponse()` → `lt(currentVideoId)` 缓存 → `window.ytInitialPlayerResponse`。循环中检查 videoDetails.videoId 是否出现在当前 URL；embed 有 title link 时再比较其 v 参数。失败后 `St()` fetch 当前页面 HTML，再从 body 直系 script 中按 `var ` 和 `ytInitialPlayerResponse = ` 分割 JSON；这个 HTML 回退返回结果未再校验 videoId。此 HTML 字符串解析方式很依赖站点打包格式。[inject L211–245](../../evidence/legacy/formatted/video-subtitle-inject.js#L211)

字幕 URL 由轨道 baseUrl 构成，强制 `fmt=json3`。先复用最新已观察 timedtext 的 `xorb/xobt/xovt/cbrand/cbr/cbrver/c/cver/cplayer/cos/cosver/cplatform`，没有时从 `ytcfg.get('DEVICE')` 和播放器 context config 获取；pot/potc 优先从 `getAudioTrack().captionTracks` 匹配 vssId 或 languageCode+kind，若没有匹配项或查询异常才退回最近观察 URL；匹配项即使没有 pot/potc 也会直接返回，不再尝试后备 URL。[inject L185–210](../../evidence/legacy/formatted/video-subtitle-inject.js#L185)、[L276–292](../../evidence/legacy/formatted/video-subtitle-inject.js#L276)

`Ut()` 的恢复顺序是：命中5分钟缓存 → 若无pot先等400ms观察结果 → fetch URL并验证JSON3 → 若返回正文但验证失败，切换原生CC并最多等600ms观察 → 重新组URL fetch一次。首次 fetch 抛错则由 `At()` 捕获并返回 error，不进入后面的 CC 恢复。`At()` 在可获得的播放器 state 小于1时每300ms等待（无全局上限；方法缺失返回undefined时不等待），选择源轨，返回 source+meta；上层 content 再按0/300/800/1500ms最多4轮重试。[inject L293–324](../../evidence/legacy/formatted/video-subtitle-inject.js#L293)、[content L10215](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10215)

### 4.4 真实选轨行为

`q()` 过滤 trackName/name 中 `CC` 或 `CC数字` 标记；`w()` 把中文简体、繁体、粤语归并为 zh-hans/zh-hant；`z()` 做精确或基础语言前缀匹配。

`K()` 先在非 CC 标记轨道中匹配，再回退全部轨道；**在同一候选组内 ASR 优先**，即使人工轨先出现在列表里：

```js
const s = o.find(i => i.kind !== "asr" && z(i.languageCode, t)),
      a = o.find(i => i.kind === "asr" && z(i.languageCode, t));
if (a) return a;
if (s) return s;
```

出处：[inject L252–262](../../evidence/legacy/formatted/video-subtitle-inject.js#L252)。因此非 CC 人工轨可先于带 CC 标记的 ASR 轨被选中；原探针只验证同一非 CC 候选组。`Rt()` 无语言匹配时在非 CC 轨中优先首个 ASR，否则首个轨；没有非 CC 轨时才使用全部轨。`vt()` 虽计算 source 与 translation，当前 At() 只请求 source，并不直接请求 YouTube 的目标语言轨。`priorityHumanSubtitle` 被发送但 At() 未读取；人工优先分支只在 controller 的非 YouTube 分支使用，且专用入口目前不支持这些平台。中文文案也明确“YouTube 始终优先使用自动生成字幕”。

源语言与目标相同时设置 shouldSkipTranslation。inject 比较通常保留 en-US 等地区差异，controller 再把非中文语言压成基础语言后比较，所以 `en-US→en-GB` 在内容端仍可能跳过；两层归一化并不完全一致。[content L10428–10452](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10428)

## 5. 字幕模型与解析

运行内存中的 cue 主要形状（概念类型，不是原 TypeScript）：

```ts
interface SubtitleCue {
  start: number; end: number; text: string; index: number;
  translation?: string;
  state?: 'loading' | 'completed' | 'error';
  provider?: string; loading?: string;
}
```

时间单位最终统一为秒。JSON3 原始数据使用 tStartMs、dDurationMs、segs[].utf8、tOffsetMs、acAsrConf。泛化 `mC` 可识别JSON数组/subtitles/captions/events、WebVTT、SRT、TTML、timedtext XML及text节点；但平台处理器表只有 `bC`，不能把格式支持扩大为多网站支持。

`bC.parseSubtitle` 先接受 `{startTime,endTime,text}` 或 `{start,end,text}` 普通cue；不匹配则走 JSON3。关键规则：

- 清理首尾空白、`>`、全角`＞`，再规整空白；空文本移除，index 重编。
- kind=asr 或 seg 中有 offset/confidence 即按ASR处理。
- `variant=punctuated` 或超过5个seg以中英文句末标点结束：按每词offset建段，后词起点约束前词结束；间隔>1200ms、句末标点、长度>30且逗号结尾、累计长度>100时断行。
- 未标点ASR按事件两两合并；无时长时默认5秒；有offset时用最大offset作为事件时长，而非再加最后词时长，这是旧行为。
- 非ASR事件缺时长时尝试下条起点差（严格大于0且小于60s）、视频剩余时长（严格大于0且小于60s），再默认5秒。
- 音乐标记 `[Music]`、括号变体、多语言音乐词和音符会独立拆段；时间按正文字符权重分配，音乐标记权重1。**这是分割，不是过滤**，`filterAmbientSounds` 未在该解析/调度链读取。

代码与边界：[L2122–2233](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L2122)。本地探针证实JSON3时间换算、ASR两两合并、音乐拆段；也保留通用WebVTT解析器对 `end timestamp + cue setting` 返回0的旧缺陷，避免迁移时误以为格式解析已完善。

## 6. 播放同步、翻译调度与缓存

### 6.1 游标与请求窗口

`M3.setupVideoEventListeners` 主要用 `<video>.timeupdate` 调用 controller。`iD.findActive` 先查当前cue及下一个cue，再二分查找；边界为 start≤time≤end。它只返回单条，不合并重叠cue。[L1919](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L1919)、[L10166](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10166)

`getPendingTranslations(time,10)` 选择开始时间落在当前±10秒的cue，排除 completed/loading/error。覆盖窗口存在、播放器时间可读且当前字幕非空时，timeupdate 处理调用 `triggerTranslation`；状态能避免重复派发。字幕配置 `preTranslation` 没有参与该窗口计算；实际不是预先翻完整视频。[L10368–10381](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10368)、[L10461](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10461)

```js
triggerTranslation(t) {
    const n = this.subtitleCursor.getPendingTranslations(t, 10);
    // 原方法中先处理同语言跳过，再传语言覆盖值调用 lD。
}
```

上面保留方法开头的原代码，省略的正文见 [L10461](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10461)。同语言跳过将cue标成completed；若隐藏原文而显示译文，则将原文复制到translation，否则删掉translation。

`lD` 把cue设loading，调用后台 translateSubtitle。返回有error时设error、写“服务出错(正在重试)”；成功设completed。后台具体队列、缓存及服务实现见翻译服务模块。内容层没有字幕专有并发限制，时间窗中的多cue可以同时派发。[L1949](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L1949)

### 6.2 重试缺陷，必须作为迁移决策保留

原实现：[L209](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L209)。

```js
function kS(e, t = 3, n = 1e3) {
    return new Promise((r, a) => {
        e().then(i => {
            t > 0 ? i ? r(!0)
                : setTimeout(() => { kS(e, t - 1, n); }, n)
                : a(new Error("重试次数耗尽"));
        });
    });
}
```

递归Promise没有接回父Promise；首次false后，即使后续成功，调用者等待的外层Promise仍不settle。reject也没有catch。不能在方案中将它描述成“可靠3次重试”。本地探针 `retry-defect-child-success-does-not-settle-parent-promise` 验证：调用2次、子请求成功，但父Promise30ms后仍pending。新实现建议改为有界循环，显式错误、取消与最终状态；这是修复建议，不是原逻辑。

### 6.3 字幕 session 缓存和对齐

`sessionStorage['cache_subtitle']` 以videoId为key保存 `{source?,translation?}`。键没有语言、模型、提示词、账户，也没有TTL/容量；页面脚本可读同源sessionStorage。[L169–184](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L169)

YouTube主动抓取成功通常优先用新字幕，源码多处对YouTube关闭源/译持久化，以免带入旧翻译；cleanup仍可能存source。更改sourceLang/targetLang/humanPreferred会删除当前videoId缓存并重新抓取，但需渲染窗口存在且当前不在加载。

存在平台译轨时，`alignTranslationSubtitles` 按译cue的中点匹配源cue时间范围，允许±0.25s，多个译cue以换行拼接；一个匹配也没有时退回按数组下标对齐。[L10388–10424](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10388)

## 7. 字幕覆盖层、拖拽、样式与导出

`M3.createContainer` 在 `#movie_player,.html5-video-player` 内添加 `#congcong-translate-caption-window`，attachShadow(open)，React根挂载。原生`.caption-window`只有自定义窗口存在且临时/自动开启时才通过全局style隐藏，清理时移除，避免关扩展后留黑字幕。[L10123–10176](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10123)

- 默认 `A3` 将原/译放同一可垂直拖拽框，`translationPosition=top` 采用column-reverse；双语/仅译文、隐藏原文/译文分别控制span。
- `enableSubtitleDrag=true` 使用 `O3`，源/译独立垂直位置，保存 `sourceSubtitlePosition` / `translationSubtitlePosition` 百分数。O3读取translationPosition计算但没有用于输出布局。
- 默认A3拖拽保存独立storage键subtitlePosition（top/bottom比例），与O3百分比配置并存，两个位置机制不能混为同一个字段。
- 字体族、字号、字重、文字色、背景色/透明度、阴影均来自subtitleRule.add；默认字号原16px、译20px，原白译黄，译文在上。opacity字符串转0..255十六进制直接拼颜色，未统一clamp/pad，值得重构校验。
- 全屏/显示控制条时全局CSS调整bottom到60/80px，shorts容器有专属高度。
- 下载菜单调用 `_3` 生成标准序号与 `HH:MM:SS,mmm --> ...`，`N3` 用Blob+临时a+revokeObjectURL，默认 `subtitle.srt`、includeTranslation=false。它下载**源字幕**，不调用background downloads API。[L10177–10189](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10177)

## 8. 设置、快速按钮与配置实际生效范围

统一配置在 `congcong_translate_config` 的 `generalRule['subtitleRule.add']` 下，schema见 [L972](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L972)，默认值见 [L1720](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L1720)。`jd()` 深拷贝后，在YouTube用youtubeAutoEnableSubtitle替换autoEnableSubtitle；inherit模式映射页面replace→translation，其余→dual。[L975](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L975)

| 字段组 | 默认值与真实用途 |
| --- | --- |
| disabled | false；入口总开关，true则不注入 |
| youtubeAutoEnableSubtitle / autoEnableSubtitle | true / false；YouTube归一化后自动开启。快速菜单改auto同时回写youtube字段 |
| translationMode / hideSourceSubtitle / hideTranslationSubtitle | dual / false / false；inherit需根据页面显示模式归一化 |
| sourceLang / targetLang | auto / zh-Hans；覆盖全局语言；更改触发字幕重载 |
| showQuickButton | true；控制播放器菜单；Alt+T切换，输入框、contentEditable和代码编辑器内不触发 |
| enableSubtitleDrag / sourceSubtitlePosition / translationSubtitlePosition | false / 85 / 90；独立拖拽模式用百分比，默认组合模式另存subtitlePosition |
| sourceFontFamily/Size/Weight/TextColor | PingFang SC / '16' / '700' / #FFFFFF |
| translationFontFamily/Size/Weight/TextColor | Lantinghei SC / '20' / '700' / #FFFF00 |
| translationPosition / textShadowType / backgroundColor / backgroundOpacity | top / none / #080808 / '39' |
| humanPreferred | false；YouTube同组内ASR优先、非CC组先于全部轨；其他平台分支残留 |
| filterAmbientSounds / preTranslation / meetingAutoEnableSubtitle | true / true / true；在本专用bundle中仅见schema和默认值，未见消费者，不能当成已实现功能 |
| userTranslationServices.subtitleTranslateService | inherit；本链路仅schema/默认值，实际后台按全局服务选翻译器 |

`tY` 在播放器`.ytp-chrome-controls`中插到`.ytp-right-controls`之前，菜单含自动开启、仅本次、下载源字幕、阅读、设置。菜单根及设置浮层各用Shadow DOM。`eY` 结合可见CC按钮/textTracks/字幕DOM/运行标记判断是否有字幕；body属性观察+html标记观察+每秒interval，状态变化时更新菜单。[L14779–14901](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L14779)

## 9. 广告、SPA和资源清理

- `tx` 通过可见广告selector、短视频+广告类名、URL/title关键词检测广告；这可能把正常带“sponsored/promo”等标题的视频误判。广告期间覆盖字幕隐藏，捕获入口也短路；广告结束发triggerSubtitle恢复。[L980–997](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L980)
- `nY` 对body childList/subtree mutation比较URL，并监听popstate；URL变化后延迟1秒读videoId，变化广播videoIdChanged。切换时关阅读层、清当前cue/cache key/skip flag/临时开启状态，再初始化与抓取。[L14904](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L14904)、[L10326](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L10326)
- k3.cleanup清渲染器、视频事件、重试定时器、CC observer、状态和global CSS。桥接订阅在destroy才解除。
- 页面脚本 `h.destroy()` 空实现；V覆盖的fetch/XHR并不恢复；h构造器中通用handleMessages返回的dispose没有保存。It.destroy只清它显式保存的三个请求handler。`waitReady`/若干setTimeout和播放器等待循环也没有统一取消。不能把这份旧代码原样移入新扩展后声称“完全清理”。
- tY.destroy没有移除setupShortcutListener注册的window keydown（字段未回收），重复隐藏/重建可能叠加Alt+T监听。M3.bindVideoElement的500ms重试不保存timer；页面销毁后仍有继续尝试风险。
- 抓取和翻译回包没有统一videoId/generation校验，SPA切换时旧异步请求可能写入新状态。阅读模式单独有版本号防护，详见子文档。

## 10. 分批重构技术方案（建议，不是旧实现）

| 批次 | 模块边界 | 依赖与交付 | 验收重点 |
| --- | --- | --- | --- |
| V1 | `video/youtube/context-bridge` | typed window协议、最小MAIN注入、播放器ID和轨道库存；依赖扩展消息与设置模块 | iframe/SPA、禁止非白名单消息、重复注入幂等、清理可验证 |
| V2 | `video/youtube/caption-source` | player response分级缓存、观察请求/凭证参数、JSON3恢复；用本地fixture先覆盖 | 无字幕、播放器未ready、授权参数变化、429、缓存TTL与容量 |
| V3 | `video/timeline` | 统一Cue秒模型、JSON3/ASR算法、cursor及language规范化；纯函数不依赖document | 已保存14项探针作为旧行为基线；明确修复解析缺陷 |
| V4 | `video/subtitle-controller` | 时间窗口、限流、取消/重试/同语跳过；复用翻译服务模块 | 失败最终态、seek向前/后、重叠cue、旧请求不得跨视频写入 |
| V5 | `video/subtitle-renderer` | Shadow DOM双语层、原字幕恢复、组合与分开拖拽 | 字体/RTL/全屏/Shorts/隐藏开关、重载后没有残留style/listener |
| V6 | 菜单、设置、SRT导出 | 设置schema迁移、菜单可用性、下载 | 仅本次不持久化、自动开关持久化、0%位置和opacity边界 |
| V7 | 字幕阅读与文章模式 | 见[子文档](05a-subtitle-reading.md) | 单独验收服务依赖与文章缓存 |
| V8 | TikTok字幕面板 | 见[独立文档](05b-tiktok-captions.md) | 不与YouTube controller强行合并 |

建议公共API仅保留 `CaptionSource.load(videoId,languages,signal)`、`Timeline.find(time)`、`SubtitleController.start/stop` 和 `Renderer.render/clear`。这些是便于分批实施的建议边界，不是声称恢复了原源码目录或接口。

## 11. 验收与未知项清单

已执行的离线基线见[探针结果](../../evidence/legacy/extracts/video/probe-results.json)：同一非CC组内选轨ASR优先、中文脚本区分、高tier保轨道、5分钟TTL、JSON3清理/时间换算、ASR合并、音乐拆分、VTT设置后缀缺陷、游标窗口、SRT仅源文、重试悬挂，以及TikTok解析3项。

后续应针对真实页面补充：

1. watch、embed、shorts、直播、不同同源/跨域iframe分别验证实际注入；未声明域名不应误报支持。
2. 无字幕/仅CC轨/人工+ASR/同目标语言/简繁目标切换。
3. fetch与XHR分别送player/timedtext；过期pot/potc、429、HTML fallback和15秒超时。
4. 暂停/seek/倍速、广告进入退出、SPA快速切三段视频，确认回包归属。
5. 打开/关闭/隐藏按钮/重新加载扩展后原字幕和事件数恢复。
6. SRT的Unicode、多行、毫秒、空文本；通用VTT cue settings与无空行fixture作为修复前后对照。

无法从安装包恢复：原TS命名/组件目录、未发货分支、真实网站当前协议、账户可用性和服务器内部字幕翻译实现。专用字幕bundle中schema但未消费的字段已显式列出；它们的未来产品定义需要设计决策。

## 12. 留存素材

- [原包文件清单与SHA-256](../../evidence/legacy/inventory.json)
- [完整可读内容脚本](../../evidence/legacy/formatted/content-scripts/video-subtitle.js)、[完整页面世界脚本](../../evidence/legacy/formatted/video-subtitle-inject.js)
- [原始字幕CSS](../../evidence/legacy/original/content-scripts/video-subtitle.css)
- [选中原声明](../../evidence/legacy/extracts/video/selected-declarations.js)、[LF行号与UTF-16字符位置索引](../../evidence/legacy/extracts/video/source-index.json)
- [离线探针脚本](../../evidence/legacy/extracts/video/probe.mjs)、[结果](../../evidence/legacy/extracts/video/probe-results.json)、[运行日志](../../evidence/legacy/extracts/video/probe.log)

复跑：在项目根目录使用Node 24执行 `node evidence/legacy/extracts/video/probe.mjs`。只提取声明并在隔离VM中执行无网络逻辑，未执行整个安装包。
