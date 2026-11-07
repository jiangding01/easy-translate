# 05b TikTok 字幕提取与阅读面板

[返回视频模块](05-video-subtitles.md) · [返回文档索引](../README.md)

## 1. 与 YouTube 分开实现的功能

TikTok字幕在全站`content-scripts/host.js`的`site-tiktok` handler内实现，不使用`video-subtitle.js`的页面注入桥或YouTube覆盖层。它提取视频已有字幕，展示可拖动、可随播放高亮的**字幕列表面板**，并按全局翻译服务翻译各句。未见把TikTok字幕渲染到视频画面上的独立覆盖字幕逻辑。

可达链：站点handler `aD.setup` → `Dft`按钮/面板控制器 → `Cft`字幕服务 → 后台`zq`原生runtime action fetch代理。后台启动为`Dq→Rq→zq`，不是只有未调用的类。源码：[host L107119–107163](../../evidence/legacy/formatted/content-scripts/host.js#L107119)、[background L9700](../../evidence/legacy/formatted/background.js#L9700)、[L9721](../../evidence/legacy/formatted/background.js#L9721)。

本模块为静态确认，另执行3项TikTok纯解析/缓存key探针，没有抓取TikTok网页或请求其字幕。

## 2. 模块和消息

| 符号 | 职责 | 原可读代码 |
| --- | --- | --- |
| `aD` | 站点setup、注册DOM字幕信息查询、mutation时重建字幕按钮 | [L107119](../../evidence/legacy/formatted/content-scripts/host.js#L107119) |
| `Dft` | URL监听、按钮、加载/错误/重试、React面板生命周期 | [L107160](../../evidence/legacy/formatted/content-scripts/host.js#L107160) |
| `Cft` | captionInfos发现、HTML fallback、字幕下载、VTT解析、结果缓存 | [L106951](../../evidence/legacy/formatted/content-scripts/host.js#L106951) |
| `Nft` | 字幕UI、逐句翻译、播放跟随、复制/导出、位置存储 | [L106871](../../evidence/legacy/formatted/content-scripts/host.js#L106871) |
| `zq` | 原生`runtime.onMessage`的action代理 | [background L9721](../../evidence/legacy/formatted/background.js#L9721) |

该通道使用原生`{action:...}`，不要误写成其他模块的webext-core `{type,...}`协议：

| action | 请求 | 响应 |
| --- | --- | --- |
| `tiktok:getCaptionInfos` | 发往已打开TikTok tab | `{success,captionInfos? ,error?}`，内容handler从DOM script解析 |
| `tiktokFetchHtml` | `{url, options:{method:'GET',headers}}` 发后台 | fetch `.text()` → `{success:true,data,body}` 或error |
| `tiktokFetchCaption` | `{urls:[url]}` 发后台 | 只fetch数组第一项 → `{success:true,data}` 或error |

后台两个代理没有HTTP `ok`检查、域名/URL白名单、返回长度上限、显式超时；HTML错误页也可能被当作成功文本。options.method在后台忽略，实际强制GET。源码声称设置User-Agent/Accept-Encoding等header不等于浏览器一定允许或按其值发送，需要runtime证据确认。重构建议改为专用受限fetch API，校验URL和字幕响应，避免通用任意地址代理。

## 3. captionInfos来源与选轨

### 3.1 先尝试打开标签页的数据

`Cft.tryGetCaptionInfosFromContent(url)` 提取 `/video/(\d+)`，调用tabs.query({})，优先URL含同videoId的tab（无ID时匹配完整URL），否则首个URL含tiktok.com的tab；并未按activeTab选择，再tabs.sendMessage。内容脚本上下文通常没有tabs API权限/可用性；该路径异常会catch→null，因此是尝试路径而非可靠主路。[L106953–106962](../../evidence/legacy/formatted/content-scripts/host.js#L106953)

接收端先读`script#__UNIVERSAL_DATA_FOR_REHYDRATION__`，否则`script#SIGI_STATE`，JSON.parse后递归找第一个非空captionInfos。它未核对所选captionInfos属于请求videoId，多视频对象存在时可能拿错。handler listener在setup注册，但返回cleanup没有移除该runtime listener，重复setup可能积累。[L107120–107147](../../evidence/legacy/formatted/content-scripts/host.js#L107120)

### 3.2 HTML fallback

拿不到信息时，向后台` tiktokFetchHtml`请求当前视频HTML。`extractCaptionInfosFromHTML`只正则找id=`__UNIVERSAL_DATA_FOR_REHYDRATION__`的script，未包含DOM路径支持的SIGI_STATE fallback；JSON解析后同样递归找第一个非空captionInfos。[L106963–106997](../../evidence/legacy/formatted/content-scripts/host.js#L106963)

### 3.3 实际只用第一条字幕信息

```js
const k = p[0], m = k.url || ((o = k.urlList) == null ? void 0 : o[0]);
```

出处：[L107051](../../evidence/legacy/formatted/content-scripts/host.js#L107051)。没有按照目标语言、人工/自动、captionFormat优先级选轨。首条缺URL时直接失败，不遍历后续条目；urlList也只尝试第一URL。captionInfo保留language、captionFormat、isAutoGen用于显示/导出和中文判断。

`fetchCaptionContent`走后台action代理。成功返回`{success:true,captionInfo,rawCaption,parsedCaptions}`，即使解析结果是空数组也会success=true；UI显示暂无字幕，与提取失败提示分开。

## 4. VTT解析和缓存

`Cft.parseWebVTT`扫描第一条含`-->`的行，正则接受`HH:MM:SS.mmm --> HH:MM:SS.mmm`，把其后非空文本按空格连接。输出：

```ts
// 从返回对象恢复的概念类型。
{ startTime: string; endTime: string; text: string;
  startSeconds: number; endSeconds: number }
```

不处理HTML标签/实体、NOTE/STYLE语义、短`MM:SS.mmm`时间格式。相比YouTube通用VTT解析器，该正则允许时间戳后有cue settings；但没有空行隔开的相邻cue可能因外层额外`o++`漏掉第二个timestamp。源码：[L107007–107035](../../evidence/legacy/formatted/content-scripts/host.js#L107007)。这些差异已通过[离线探针](../../evidence/legacy/extracts/video/probe-results.json)确认。

`captionsCache`是进程内Map，key优先`video_${id}`否则完整URL；存成功/失败，但只重用success项。没有TTL或容量上限。ignoreCache删除旧项重新请求。[L107036–107078](../../evidence/legacy/formatted/content-scripts/host.js#L107036)

## 5. 字幕列表UI与翻译

`Dft.setupCaptionButton`仅URL包含`/video`时建立左下固定“字幕”按钮。首次点击打开面板，未有字幕/有error时extract；关闭只隐藏面板并恢复按钮。重试复用extract；错误一般转换为“该视频无自带字幕”，会丢失网络错误具体原因。[L107165–107239](../../evidence/legacy/formatted/content-scripts/host.js#L107165)

`Nft`行为：[L106871–106950](../../evidence/legacy/formatted/content-scripts/host.js#L106871)。

- 面板位置默认{x:20,y:120}，从storage.local.captionPanelPosition恢复；拖拽结束写回，没有视口clamp，浏览器尺寸改变可能把面板留在屏幕外。
- 找第一个video，监听timeupdate；以startSeconds≤time<endSeconds线性findIndex当前字幕，更新active类并scrollIntoView(center,smooth)。列表收到任何scroll事件后10秒暂停自动跟随；处理器没有区分用户滚动和 `scrollIntoView` 产生的程序滚动。
- 单击字幕行seek到startSeconds并play，重置手动滚动标记。
- captionInfo.language/languageCode字符串包含zh/chinese/mandarin/cantonese等即认为中文；中文不自动翻译，其余自动译。这不是根据全局目标语言判同语，会与用户非中文目标冲突。
- 打开可见面板后GET_CONFIG，用`Promise.all(captions.map(...Hu(text,config)))`一次派发所有未翻译cue，最终批量合并结果。UI本层没有专属并发限制，依赖Hu下游服务队列/去重；失败被吞掉，缺译文可在后续触发中补。
- `translation`按数组下标存在内存；caption数组变化时清空。unmount后用Cn.current防止setState，但未取消已发送请求；切换视频旧Promise可能仍完成，需跨会话归属校验。

原翻译核心片段：

```js
await Promise.all(t.map(async (Pr, yr) => {
    if (!wt.current[yr])
        try {
            const ir = await Hu(Pr.text, ga);
            ir && typeof ir == "string" && (Mn[yr] = ir);
        }
        catch { }
}));
```

出处：[L106895–106902](../../evidence/legacy/formatted/content-scripts/host.js#L106895)。Hu是host通用翻译入口，具体服务和提示词不能从TikTok面板独立推断。

## 6. 下载、复制与SPA

- 下载为`text/plain;charset=utf-8`，文件名`tiktok-captions-${Date.now()}.txt`。标题头含语言、自动生成、条数、是否含译文、导出时间。每段是`[startTime --> endTime]`+源文，可追加当前已有译文；不是SRT。用Blob+objectURL+临时a下载。
- 复制使用navigator.clipboard.writeText，时间去掉毫秒，已有译文用缩进另起一行；失败静默。[L106911–106943](../../evidence/legacy/formatted/content-scripts/host.js#L106911)
- `Dft`以body MutationObserver检查URL变化，120ms debounce。handleUrlChange先cleanup，保留isVisible，300ms后重建按钮；如果旧Map有成功结果先展示，随后ignoreCache=true请求新数据。[L107162–107164](../../evidence/legacy/formatted/content-scripts/host.js#L107162)
- setupUrlMonitoring中的observer只在局部变量持有，cleanup不disconnect，也不clear urlChangeTimer。cleanup会把isFetching=false，但旧extract Promise没有abort或generation校验，可能新旧请求并发并串写。重构需要修复，不能照搬该清理方式。

TikTok同一站点handler还含标题alt剪裁翻译、hashtag替换等，与视频字幕提取不是一个功能，归网页站点适配模块记录。

## 7. 分批重构建议与验收

建议独立模块：`tiktok/metadata-source`、`tiktok/caption-source`、`vtt-parser`、`caption-panel-controller`、`caption-panel-view`。可与YouTube共享最终Cue类型和SRT导出工具，但保留不同取数协议和UI。

1. 保存的HTML/JSON/VTT fixture下先实现纯解析和videoId归属检查，支持完整/短时间格式、cue settings/多行/实体。
2. content读取当前页JSON优先，后台只负责允许域名的字幕抓取；加入HTTP状态、超时、响应类型/长度、URL fallback策略。
3. 加入语言/目标轨选择，不以p[0]作为永久规则；缓存key包含videoId+track标识+语言，设置TTL/容量。
4. 列表显示、seek、播放跟随、位置clamp，先不用全量自动翻译；再用受控队列接通翻译。
5. SPA generation+AbortController，cleanup清所有observer/timer/listener，已卸载回包必须忽略。
6. TXT/复制保持原能力，可另增加标准SRT，但那是新需求，不能称旧实现已有。

验收：首条无URL但第二条有效、urlList多个CDN；HTML只有SIGI_STATE；多video数据中captionInfos归属；HTTP 403/HTML challenge/空VTT；无毫秒/短时间/无空行/HTML标签；中文源文→英文目标；拖拽后缩小窗口；快速切三个视频、旧请求晚回、handler重复setup/dispose、关闭后网络仍返回。真实TikTok当前数据结构和CDN访问能力保留为待验证。

## 8. 证据留存

可读完整[host.js](../../evidence/legacy/formatted/content-scripts/host.js)与[background.js](../../evidence/legacy/formatted/background.js)保留全部实现。Cft原声明已归入[selected-declarations.js](../../evidence/legacy/extracts/video/selected-declarations.js)，精确LF行号见[source-index.json](../../evidence/legacy/extracts/video/source-index.json)。本地14项探针包含TikTok的3项基线，见[probe-results.json](../../evidence/legacy/extracts/video/probe-results.json)。
