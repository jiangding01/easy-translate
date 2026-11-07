# 04 · 截图、内容分享、Markdown与文档翻译入口

[返回技术方案入口](../README.md) · [页面管线](02-page-translation.md) · [悬浮球入口](03-selection-and-floating-ui.md)

## 1. 功能边界与恢复结论

本模块恢复的是安装包本地实现，不把外部网站能力当作扩展内置能力。

| 用户可见能力 | 本地实现结论 | 证据 |
| --- | --- | --- |
| 框选/长截图 | 已存在跨视口拼接、PNG、水印和后台下载链路 | `nXe → jle → oXe → captureVisibleTab/downloadImage` |
| 截图后OCR翻译 | **该截图链路未调用OCR或图像翻译**；它是保存页面截图（页面可能已经翻译） | 完整jle/oXe及调用方 |
| 分享翻译内容 | 提取文章块，独立重新翻译，Markdown编辑/复制、分页图片/ZIP导出 | `Qot → elt → tlt → dlt` |
| PDF/文档翻译 | 检测PDF并打开外部`https://cocotranslate.com/doc` | Dle、YYe、popup Ul |
| 普通网页“文章阅读模式” | 本模块找到的是分享编辑/预览，不据chunk名推断独立阅读器 | reading-article chunk导出为SDK/规则等共享代码 |
| 视频文稿/阅读 | TikTok和YouTube字幕相关实现归视频字幕模块 | host站点处理器 / video-subtitle |

没有在此阶段实现这些能力；网络服务及真实浏览器运行效果见总索引的验证覆盖说明。

## 2. 截图触发与选区交互

触发点：悬浮球截图按钮、`startScreenshot`消息，后台manifest.commands也会转发该消息。Content Script将实际截图/下载委托后台；自己负责选择、滚动、canvas合成。悬浮球按钮传入隐藏/恢复回调；`startScreenshot`消息入口没有传这些回调，因此快捷键截图不会通过此机制隐藏悬浮球。后台按消息发送者的 `tab.windowId` 调用 `captureVisibleTab`，捕获的是该窗口当时的活动标签页，而非指定发送者tab；截图过程中切换标签页可能错取画面。下载默认 `saveAs:true`，只检查启动下载的返回结果，不追踪保存完成（[background L9070–L9074](../../evidence/legacy/formatted/background.js#L9070)）。后台方法实现见后台通用能力模块。

`nXe`向documentElement插入全屏遮罩，pointerdown记录**文档坐标**（clientX/Y + scrollX/Y）；移动更新矩形并夹在页面尺寸内。靠上/下边40px时以每frame约10px自动滚动，可框选超过一个视口的高度；不含水平自动滚动。pointerup/pointercancel结束，宽或高小于2px视作取消；Escape和右键取消。退出清理pointer/keydown/scroll监听、requestAnimationFrame和遮罩，避免把选区UI一起截进图。

`BO`是单次截图互斥标记。`jle`获取选区后通知UI隐藏，调用合成，生成带ISO时间戳的`coco-screenshot-*.png`，后台下载成功才返回success。取消、下载失败、异常均返回结构化error，finally恢复UI/释放BO。


来源：[`jle`：host.js L20552–L20566](../../evidence/legacy/formatted/content-scripts/host.js#L20552)；[完整摘录](../../evidence/legacy/extracts/page/20552-jle.js)。

```js
async function jle(e) { var n, r; if (BO)
        return { success: !1, error: "Screenshot already in progress" }; BO = !0; let t = !1; try {
        const o = await nXe();
        if (!o)
            return { success: !1, error: "Screenshot cancelled" };
        (n = e.onCaptureStart) == null || n.call(e), t = !0;
        const d = await oXe(o, e.captureVisibleTab), k = `coco-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`, m = await e.downloadImage(d, k);
        return m != null && m.success ? { success: !0 } : { success: !1, error: (m == null ? void 0 : m.error) || "Download failed" };
    }
    catch (o) {
        return { success: !1, error: o instanceof Error ? o.message : "Screenshot failed" };
    }
    finally {
        t && ((r = e.onCaptureEnd) == null || r.call(e)), BO = !1;
    } }
```


完整选区实现：[`nXe`：host.js L20532–L20549](../../evidence/legacy/formatted/content-scripts/host.js#L20532)。截图入口：[host L106004](../../evidence/legacy/formatted/content-scripts/host.js#L106004)，悬浮球隐藏/恢复见[`vlt`：host.js L103146–L103221](../../evidence/legacy/formatted/content-scripts/host.js#L103146)。

## 3. 长截图拼接算法

`oXe`工作顺序：

1. 保存原scrollX/Y；`aXe`临时隐藏body下所有computed position=fixed/sticky元素，保留inline visibility/pointerEvents，避免导航在每片重复出现。
2. 滚到选区y的合法起点，等两次requestAnimationFrame再等150ms，调用后台captureVisibleTab取PNG data URL并解为Image。
3. 从首片naturalWidth/window.innerWidth、naturalHeight/window.innerHeight计算X/Y真实缩放比，不能直接假定devicePixelRatio。
4. `iXe`限制canvas高度：宽像素至少1，计算高度时使用32767像素上限及268435456像素预算；代码没有将canvas宽度夹到32767，也不能保证极端宽度下符合总像素预算。必要时裁短选区高度，不保证任意长选区全量输出。
5. 当前视口与选区做矩形交集 `rXe`，把截图对应像素裁到目标canvas对应位置。
6. 每次向下推进一个innerHeight，重复滚动/等待/截图。相邻capture约至少520ms；不做横向多片拼接。
7. 尝试用 `Hle`在右下以约0.35 alpha绘制Logo与“椰子翻译”水印；Logo加载失败仅省略Logo，其他水印绘制异常也被捕获，不阻止截图。
8. 导出image/png；finally恢复fixed/sticky样式和原滚动位置，即使canvas/图像/后台调用失败。


来源：[`iXe`：host.js L20576–L20576](../../evidence/legacy/formatted/content-scripts/host.js#L20576)；[完整摘录](../../evidence/legacy/extracts/page/20576-iXe.js)。

```js
function iXe(e, t, n) { const d = Math.max(1, Math.round(e * t)), p = Math.min(32767, Math.floor(268435456 / d)); return Math.max(1, Math.floor(p / n)); }
```


完整实现：[`oXe`：host.js L20577–L20607](../../evidence/legacy/formatted/content-scripts/host.js#L20577)、[`aXe`：host.js L20570–L20575](../../evidence/legacy/formatted/content-scripts/host.js#L20570)、[`Hle`：host.js L20529–L20530](../../evidence/legacy/formatted/content-scripts/host.js#L20529)。矩形计算和比例必须使用同一坐标系统；CSS zoom、视口尺寸变化、动态高度/布局变化、截图中持续动画均需后续真实运行验证，静态分析不能证明拼接无缝。

## 4. 分享内容的提取模型

悬浮球分享按钮打开 `klt`，通过独立ShadowRoot/portal承载 `dlt`，不会把整页DOM直接复制成文章。`dlt.ga → Uw → Qot`从当前翻译根提取原文块。

`Qot`支持：heading(H1–H6)、paragraph(P)、list-item(LI)、blockquote、code(PRE)、image(IMG)，每块保存id/type/text/originalMarkdown/element，以及headingLevel/listMarker/imageUrl/imageAlt/isExplicitlyIncluded等字段。

- 忽略SCRIPT/STYLE/NOSCRIPT/SVG/CANVAS/IFRAME、译文wrapper、不翻译标记、根外区域；允许读取被普通翻译隐藏的原文，而不把译文当原文再翻一遍。
- `e_`递归读取源文本，BR转换行；普通段落经rv合并空白。PRE保留代码，shouldTranslate=false。
- LI克隆后去掉内部UL/OL读取本层文本，再遍历嵌套列表；有序列表通过同级位置生成序号。
- 图片去重；从currentSrc、srcset/data-srcset中最高score项、data-src/data-original/data-url/data-lazy-*等懒加载属性与src获取URL，并按document.baseURI补全。
- `Vw`转Markdown：heading加#、list加标记、blockquote加>、code加围栏、image转Markdown图片语法（alt与URL）；它是**有限块级转换器**，不是通用HTML到Markdown完整保真转换，未保留任意表格/所有行内富文本。

证据：[`Qot`：host.js L30123–L30154](../../evidence/legacy/formatted/content-scripts/host.js#L30123)、[`Hfe`：host.js L30055–L30060](../../evidence/legacy/formatted/content-scripts/host.js#L30055)、[`Yot`：host.js L30070–L30073](../../evidence/legacy/formatted/content-scripts/host.js#L30070)、[`e_`：host.js L30074–L30089](../../evidence/legacy/formatted/content-scripts/host.js#L30074)、[`Xot`：host.js L30090–L30090](../../evidence/legacy/formatted/content-scripts/host.js#L30090)、[`Vw`：host.js L30091–L30117](../../evidence/legacy/formatted/content-scripts/host.js#L30091)，[host L30053–L30122](../../evidence/legacy/formatted/content-scripts/host.js#L30053)。

## 5. 独立翻译与Markdown组合

分享不是只导出当前页面已显示的译文。`elt`创建最多3个worker，从共享索引队列逐块调用Hu，保持数组索引以还原原文顺序；代码/图片不翻译，显式include可绕过常规长度阈值。普通块遵守textRange和BS展示策略，replace模式会强制请求应该翻译的块。某块失败记为空串，不阻止其他块输出。

`tlt`同时构造originalMarkdown、translatedMarkdown和composedMarkdown；replace模式译文空时保留原文；compare模式按原块顺序插入原文再插译文。


来源：[`tlt`：host.js L30175–L30187](../../evidence/legacy/formatted/content-scripts/host.js#L30175)；[完整摘录](../../evidence/legacy/extracts/page/30175-tlt.js)。

```js
async function tlt(e, t, n) {
        const r = await elt(e, t, n), o = e.map(k => k.originalMarkdown).join(`

`).trim(), d = e.map((k, m) => { const w = r[m]; return w ? Vw(k, w) : ""; }).filter(Boolean).join(`

`).trim(), p = [];
        return e.forEach((k, m) => { const w = r[m]; if (n === "replace") {
            p.push(w ? Vw(k, w) : k.originalMarkdown);
            return;
        } p.push(k.originalMarkdown), w && p.push(Vw(k, w)); }), { originalMarkdown: o, translatedMarkdown: d, composedMarkdown: p.filter(Boolean).join(`

`).trim(), blocks: e };
    }
```


这套管线与网页DOM渲染分离，但共用Hu，因此请求仍可能涉及网络、AI缓存、术语表及风格提示；重新打开/重新生成可能重新产生请求，不能宣传为无额外调用成本。

## 6. 编辑、预览与导出

### 编辑与渲染

默认share mode从displaySettings.mode映射replace/compare；默认比例3:4(1080×1440)，主题Typora，另有Ink Serif。完整8种比例和主题已保存 [share-presets.json](../../evidence/legacy/extracts/page/share-presets.json)。自定义宽/高、60%–300%缩放、页数测量、当前块数都属于分享UI。

`llt`封装Vditor 3.11.2即时渲染模式(IR)，关闭编辑器缓存、toolbar、计数和hljs。用户编辑后标记dirty；切换replace/compare或重新生成前window.confirm防止覆盖。输入更新通过Markdown→React静态HTML→测量容器的scrollHeight更新预览与页数。

复制按钮取当前编辑器值，空白内容不复制；优先clipboard.writeText，失败环境回退隐藏textarea + execCommand('copy')；没有找到明确的`.md`文件下载分支，不能把“复制Markdown”写成“下载Markdown文件”。

### 图片/ZIP

`dlt`将当前编辑内容转HTML，按页高算ceil(scrollHeight/pageHeight)，创建隐藏逐页容器，以translateY(-pageIndex*pageHeight)裁成分页视图。导出读取编辑器值时使用 `||` 回退到缓存文本，空字符串可能因此回退到旧值。逐页调用snapDOM `toCanvas`，scale=2、dpr夹在1–2，嵌入字体、soft cache、背景色取页面computed值，然后尝试同截图链路加水印，水印失败被忽略。

- 单页：PNG dataURL经 `downloadImage({saveAs:true})`下载。
- 多页：JSZip逐页放`coco-translate-share-N.png`，generateAsync(blob)→FileReader dataURL→下载`coco-translate-share-<timestamp>.zip`。
- 导出调用等待后台响应，但未检查返回对象的 `success`；如果后台以已解决的失败对象返回，界面仍可能提示“导出完成”。截图的 `jle` 则检查了 `success`。
- 未找到“直接输出PDF”分支；PDF翻译外跳与分享导出是不同功能。

证据：[`dlt`：host.js L100654–L100716](../../evidence/legacy/formatted/content-scripts/host.js#L100654)、[`llt`：host.js L100624–L100633](../../evidence/legacy/formatted/content-scripts/host.js#L100624)、[`clt`：host.js L100635–L100652](../../evidence/legacy/formatted/content-scripts/host.js#L100635)、[`klt`：host.js L103141–L103142](../../evidence/legacy/formatted/content-scripts/host.js#L103141)，[host L100653–L100717](../../evidence/legacy/formatted/content-scripts/host.js#L100653)。完整代码在[dlt.js](../../evidence/legacy/extracts/page/100654-dlt.js)。

### 已确认资源缺口

`llt`配置 `runtime.getURL('/vditor/dist/index.js')`推导cdn和`/vditor/dist/js/lute/lute.min.js`。旧manifest声明可访问`vditor/dist/**`，但本次53文件快照**没有vditor目录**。即使bundle内含Vditor/Lute相关代码，也不能假定运行时请求的路径存在或资源加载必然成功；需在后续浏览器验证/重构时补齐明确的本地资源。这是实际包资源缺口，不是推测有远程CDN可自动修复。

## 7. PDF与外部文档站点

`Dle`检测 `document.contentType=application/pdf`、URL pathname以.pdf结尾、或embed/object的application/pdf。主按钮转换为打开文档翻译，附加“翻译此PDF”提示；dismiss写storage.local的`pdfTranslationHintDismissed`。


来源：[`Dle`：host.js L20492–L20492](../../evidence/legacy/formatted/content-scripts/host.js#L20492)；[完整摘录](../../evidence/legacy/extracts/page/20492-Dle.js)。

```js
function Dle() { return document.contentType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(window.location.pathname) ? !0 : !!document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]'); }
```


`YYe`仅发送 `openUrl({url:'https://cocotranslate.com/doc'})`；popup同样有该URL。该调用没有将当前PDF字节/当前URL打包上传的参数。安装包范围内不能恢复该网站服务端、解析器、文档格式支持、上传流程、翻译版面保真和下载结果，也不能据“打开文档翻译”文案声称扩展自己解析PDF/DOCX。

证据：[`YYe`：host.js L20493–L20493](../../evidence/legacy/formatted/content-scripts/host.js#L20493)、[`vlt`：host.js L103146–L103221](../../evidence/legacy/formatted/content-scripts/host.js#L103146)、[popup L1321](../../evidence/legacy/formatted/chunks/popup-C6IAxVei.js#L1321)。如果未来要内置文档翻译，应作为单独新需求，不是无成本迁移已有本地引擎。

## 8. 分批重构建议（尚未实现）

| 批次 | 建议交付 | 依赖/注意 |
| --- | --- | --- |
| C1 | 当前视口框选→canvas裁剪→本地PNG下载，互斥/取消/恢复 | 后台capture/download权限与消息验证 |
| C2 | 纵向长截图、真实比例、固定元素暂隐、canvas限额、水印可配置 | C1，固定尺寸fixture与实际设备缩放测试 |
| R1 | 只读ArticleBlock提取、Markdown组合/复制，明确支持的块类型 | 页面根/过滤、翻译服务 |
| R2 | 三worker可取消翻译、逐块错误、replace/compare、保留用户编辑 | R1，独立会话id/source snapshot |
| R3 | 本地打包编辑器、主题/分页预览、PNG与ZIP导出 | R2，资源完整与可访问路径检查 |
| D1 | 保留清楚标识的外站入口，或另立本地文档引擎方案 | 外部系统不可从本包完整恢复 |

不要为截图添加未经用户确认的OCR服务，也不要为了恢复分享功能直接拷贝所有编辑器/SDK压缩代码。只选择明确需要的模块与离线可用资源。

## 9. 验收与未知

- 截图：取消/小于2px/重复启动/下载失败；不同滚动位置、2倍像素、超过视口、多片尾部、固定元素样式恢复；canvas上限应明确提示截短。
- 分享：heading/list嵌套/code/image/懒加载图、隐藏原文/已有译文、零块；每块失败保留源文且顺序不乱。
- 编辑：dirty确认、切换模式、缩放、分页边界、复制当前编辑值、单PNG/多页ZIP、水印、缺失字体/图片资源。
- PDF：.pdf、content-type、embed/object三种检测，提示关闭持久化，打开目标URL失败提示；不把外站成功当作本地实现。
- 仍未知：真实站点变更、图片跨域/字体加载、缺失vditor资源实际运行表现、外站文档能力；没有用代码中模型名/SDK导出推断这些功能已联通。
