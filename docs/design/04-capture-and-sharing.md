# 04 · 截图、内容分享、Markdown与文档翻译入口

本文为待实施方案。截图保存当前页面像素，不执行 OCR；分享从源文快照独立提取和翻译。页面能力依赖 [02](02-page-translation.md)、入口见 [03](03-interactions.md)，翻译、平台、资源和契约分别由 [01](01-translation-core.md)、[11](11-browser-platform.md)、[12](12-i18n-and-assets.md)、[13](13-protocols-and-data.md) 提供。

```ts
type CaptureRect = { x: number; y: number; width: number; height: number } // 文档 CSS 像素
type ArticleBlock = { id: string; type: 'heading'|'paragraph'|'list-item'|'blockquote'|'code'|'image'; source: string; markdown: string; shouldTranslate: boolean }
type ShareSession = { sessionId: string; generation: number; source: readonly ArticleBlock[]; signal: AbortSignal; dirty: boolean }
type DownloadState = 'started'|'completed'|'failed'|'cancelled'
```

截图、分享各有独立 session/generation 和 AbortSignal；共享翻译服务不共享任务所有权。关闭分享只取消其工作，不停止页面翻译；页面停止也不破坏已经生成的分享快照。重新生成前 dirty 内容需用户确认，确认后才换代；用户编辑不能被异步结果覆盖。

## 截图

全页遮罩以 `client + scroll` 文档坐标记录选区；上下 40px 内每帧约 10px 自动滚动，不横向自动滚动。pointerup 完成；新方案把 pointercancel、Escape、右键和宽或高小于 2px 明确视为取消。旧代码把 pointercancel 当结束事件，可能接受已画选区。选区完成时记录固定横向视口范围，rect必须完整位于该范围内；本设计仅做纵向拼接，横向越界时提示重新框选，不输出带空白缺口的成功图片。单 tab 互斥，任何出口均清理监听、遮罩、动画帧并释放锁。

```text
capture(rect, signal):
  create capture session; subscribe to tab activation, navigation and window lifecycle
  any relevant event permanently invalidates this capture session
  save scroll and each fixed/sticky element's inline visibility/pointerEvents
  require rect fully inside saved horizontal viewport bounds
  subscribe scroll events; any scrollX change permanently invalidates this session
  hide capture UI and fixed/sticky; verify sender tab remains active
  for each vertical viewport intersecting rect:
    throw if signal aborted, capture session invalidated, or sender tab is no longer active
    scroll; wait two animation frames and 150ms
    throw if signal aborted, capture session invalidated, or sender tab is no longer active
    require current scrollX equals saved scrollX and horizontal bounds remain unchanged
    record actual scrollX/scrollY after browser clamping
    image = captureVisibleTab(sender.windowId)
    throw if signal aborted, capture session invalidated, or sender tab is no longer active
    require current scrollX equals saved scrollX and horizontal bounds remain unchanged
    first image: scaleX = image.width / innerWidth; scaleY = image.height / innerHeight
    validate canvas width <= 32767, height <= 32767, width*height <= 268435456
    crop using actual scroll coordinates and composite only the uncovered intersection
    record covered vertical intervals; stop if full rect is covered
    fail if no progress or uncovered rows remain at document end
    wait so captures are at least ~520ms apart
  require full rectangle coverage; optionally add watermark; request PNG download
  finally unsubscribe capture events; restore styles, scroll, UI and lock
```

比例从实际首片自然尺寸计算而非假设 DPR；尺寸超预算时明确提示并让用户选择截短或取消，不静默丢失内容。旧代码只按宽度计算高度上限（32767 高、268435456 像素），并未夹宽，极宽时也不保证总像素预算；新设计同时检查宽高及面积。截图仅纵向拼接，视口变化、缩放或tab切换使会话不可逆失效。通过scroll事件记录横向视口变化并使会话失效，每片前后再次核对固定scrollX，避免部分宽度被误算为整行覆盖；通过tabs.onActivated等事件记录任何中途切换，包括切走再切回；每片前后同时检查失效标记及活动tab。捕获结果在会话失效后丢弃，实际事件与捕获时序仍需浏览器测试；动态布局和固定元素需实际设备测试。水印失败不阻止保存。

旧悬浮球入口传隐藏/恢复回调，快捷键消息入口没有；新设计所有入口经过同一 UI 隐藏及 finally 恢复协议。平台层检查下载启动结果并订阅完成/失败/取消，区分已启动和已完成；不支持完成事件时只能报告已启动。旧截图只检查启动返回，分享甚至未检查返回对象的 success，均不能视作保存完成。

## 分享提取、翻译与导出

从页面翻译根提取只读源文，排除已有译文 wrapper、脚本、画布、iframe 和不翻译区域，保留 heading、paragraph、list-item、blockquote、PRE、image。嵌套列表分层读，代码不翻译；图片从 currentSrc、srcset、懒加载属性或 src 解析并以 baseURI 补全、去重。转换为有限块级 Markdown，不承诺表格或所有行内富文本保真。

最多 3 个 worker 从不可变快照取块，按原索引存结果；代码/图片不翻译，显式 include 可绕过长度阈值。普通块使用页面过滤和显示策略，replace 强制请求应翻译块。单块失败保留原文并标记错误，不阻塞其他块；compare 按原文、译文顺序组合，replace 缺译文时保留原文。此过程可能产生新的服务调用和费用。

编辑器支持复制当前 Markdown、replace/compare、主题、比例、自定义宽高和 60%–300% 缩放；默认 3:4（1080×1440）及 Typora 主题。用户清空内容是有效编辑，不得回退旧缓存。分页依测量高度，单页导出 PNG，多页打包 ZIP；导出前等待字体/图片并报告失败，下载状态采用上述协议。旧方案使用 Vditor 3.11.2 IR 并引用 `vditor/dist/index.js` 与 `vditor/dist/js/lute/lute.min.js`，但旧快照缺少该目录；实施时先确定编辑器选型，再由模块12打包并验证实际依赖；选择Vditor时须补齐对应本地资源，不能假设远程 CDN 补齐。复制不等于 Markdown 文件下载；本方案不承诺 PDF 导出。

## PDF 与边界

检测 PDF content-type、URL `.pdf` 或 PDF embed/object 后，入口打开外部 `https://cocotranslate.com/doc`；旧调用没有传当前 URL 或文件字节，也未提供本地 PDF 解析或 OCR。外站上传、处理及下载能力不在本模块保证范围；不自动上传文件。

## 验收

- 选区小于 2px、pointercancel、重复启动、取消/失败及 tab 切换均恢复滚动、样式、UI 和锁；验证非1:1 X/Y比例、横向越界、捕获中横滚后中止且无成功导出、底部scrollTo夹取、覆盖缺口、切走再切回、长截图尾片、宽高及面积边界。
- 两个入口均隐藏恢复 UI；下载启动、完成、失败、取消和无法观察完成分别展示正确状态。
- 嵌套列表、代码、懒加载图、已有译文、零块及部分翻译失败保持顺序和源文；取消/重生成/关闭期间迟到结果不能覆盖编辑或影响页面翻译。
- dirty 确认、空编辑、分页、单 PNG/多页 ZIP、资源缺失与离线本地编辑器；PDF 三种检测和外链失败均有测试。真实站点、字体/跨域图片和截图缩放效果待实施后验证。
