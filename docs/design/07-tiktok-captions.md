# TikTok 字幕提取与列表面板

状态：待实施。TikTok 是 host 站点处理器的独立入口，不使用 [YouTube 桥与覆盖层](05-youtube-subtitles.md)。翻译依赖 [01](01-translation-core.md)，配置依赖 [08](08-configuration-and-ui.md)，消息与会话遵循 [13](13-protocols-and-data.md)。真实站点结构及 CDN 可用性待验证。

## 目标与职责

识别视频页，获取已有字幕、解析 VTT，在可拖动列表展示并跟随播放；提供全量逐句翻译、复制和 TXT 下载。host 管理按钮、面板和 DOM 元数据；后台执行受限的 HTML/字幕 GET；不把列表误称为视频覆盖字幕。

```ts
type CaptionInfo = { id: string; language: string; format: string; isAuto: boolean; urls: string[] };
type Caption = SubtitleCue; // startMs/endMs 为整数毫秒，定义见 13
type CaptionSession = { videoId: string; generation: number; track: CaptionInfo; captions: Caption[] };
type CaptionAction = { action: 'tiktok:getCaptionInfos'; videoId: string }
  | { action: 'tiktokFetchHtml'; url: string }
  | { action: 'tiktokFetchCaption'; urls: string[] };
```

旧路径使用上述原生 action，而非另一套 type 消息；新实现通过 [13](13-protocols-and-data.md) 的适配层为其增加请求及会话标识，不把 action 当成授权。后台仅接受指定 TikTok 页面和经验证的字幕 CDN HTTPS 地址，校验重定向、HTTP 状态、内容类型和大小，并设置截止时间；不提供任意 URL 代理。

## 流程和边界

```text
onVideoPage(videoId):
  cancel previous generation; create button
onOpen:
  infos = parse current DOM hydration JSON matching videoId
  if none: infos = parse bounded background HTML fallback matching videoId
  track = first info; choose first valid URL from track.urls
  vtt = await restrictedFetch(track URL)
  captions = parseVTT(vtt); show panel; enqueue every caption for translation
  commit only when generation still matches
```

旧实现首条信息、首 URL，不按语言选轨；本设计保持首轨选择，首 URL 无效或失败时尝试该轨后续 URL，不悄悄切换另一轨。DOM 支持 `__UNIVERSAL_DATA_FOR_REHYDRATION__` 和 `SIGI_STATE`，HTML fallback 同样支持两者，均验证 videoId 归属。VTT 解析支持完整及短时间、cue settings、多行、实体与相邻 cue；忽略 NOTE/STYLE 块，校验整数毫秒时间、`endMs > startMs` 与文本。空字幕和请求失败分别呈现。

缓存按 videoId、轨道标识及语言保存成功结果，默认有效 5 分钟、最多 100 项；刷新可绕过缓存，失败不缓存。面板默认位置 `{x:20,y:120}`，持久化后按视口限制；timeupdate 将播放器 currentTime 乘 1000 并取整，查找 `startMs ≤ tMs < endMs`，用户滚动后暂停自动跟随 10 秒，程序滚动不触发暂停。点击行将 startMs 除以 1000 后写入 currentTime，跳转并尝试播放，失败可见。可见面板对全部 cue 排队翻译，使用 [01](01-translation-core.md) 的受控并发和去重，依据源/目标语言判断同语，不固定将中文当成无需翻译。翻译逐句更新，失败可重试。

TXT 包含语言、自动生成标记、条数、导出时间以及 `[start --> end]`、原文和当前已有译文；复制同样包含当前译文。导出不等待尚未完成的翻译，并向用户明确当前状态。

## 生命周期与失败

视频 SPA 导航、重试和关闭时清理 observer、定时器、监听和面板资源，取消可取消请求；后台或翻译晚回时校验 sessionId/generation。受限地址、403、挑战页、无轨、空 VTT、解析错误与网络失败均为不同可诊断状态。仅视频页显示按钮；页面离开后不恢复旧视频结果。

## 旧行为与设计差异

| 项目 | 旧行为 | 新设计 |
| --- | --- | --- |
| 入口/取轨 | host 独立处理器，原生 action，首轨首 URL | 保持独立入口及首轨，允许该轨 URL 回退 |
| 元数据 | DOM 可读两类 script，HTML 仅一种；递归首个 captionInfos 未校验归属 | 两路径均验证 videoId |
| 翻译 | 全量 Promise.all，无专属上限；中文默认不翻 | 保留全量，用受控队列与目标语言比较 |
| 缓存和清理 | 进程 Map 按 videoId/URL，无 TTL；observer 和旧请求可能遗留 | 限期容量、完整清理和 generation 校验 |

## 验收

- 双种 hydration script、多视频对象、首轨无 URL、同轨多 URL，验证归属及选轨；后台拒绝不允许域名和越界重定向。
- VTT 短时间、settings、相邻 cue、实体、多行和空内容；403、HTML challenge、超时均显示不同失败。
- 全部句子入队且遵守翻译并发，中文到英文可翻；TXT 时间、原文与已有译文正确。
- 快速切换三个视频、关闭后旧请求返回、重复初始化及缩小窗口，验证无串写、泄漏或面板出界。
