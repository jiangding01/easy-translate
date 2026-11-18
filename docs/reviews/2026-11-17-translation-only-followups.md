# 「仅看译文」遗留问题核实（2026-11-17）

- **来源**：排查 PR #27（只看译文模式下 ch/em 限宽段落塌成竖排）的子会话，在修复之外又报出 4 个问题和 1 条工程建议。
- **核实方式**：
  - 主会话读 `src/content/styles.ts` 和 `src/content/render.ts`（main 634ffd5）；
  - 在 Chrome 156 中打开本地测试页：根元素 `<p>` 设 `margin:0 auto; padding:5%; letter-spacing:.2em; word-spacing:1em; border:.5em; border-radius:1em`，另有一个 `max-width:50vw` 的段落；对比根元素加 `font-size:0!important` 前后的 `getComputedStyle` 和 Typed OM 读数。

## 机制

「仅看译文」给根元素加上 `[data-et-only]`，样式为 `font-size:0!important`（`styles.ts:20`），用来藏住裸文本节点。副作用是根元素上用 em/ch 写的长度会跟着归零。

PR #27 的做法：在归零前读出 `PINNED`、`PINNED_TYPED` 里各属性的计算值，以内联像素钉住（`render.ts:214-246`）。下面的问题都出在这个“读值再钉住”上。

## 结论

| # | 问题 | 结论 | 实测证据 |
|---|---|---|---|
| 1 | `margin: 0 auto` 居中的段落被钉成固定像素，在仅看译文状态下调整窗口后不再居中 | **属实** | `getComputedStyle` 的 `margin-left` 为 `242px`，Typed OM 为 `auto`。margin 的 resolved value 是使用值，`render.ts:212` 注释里“keywords and % kept”的说法对 margin 不成立 |
| 1b | （新增）`padding` 用百分比时同样被钉成像素 | **属实**，与第 1 条同类 | `padding-left` 为 `50px`，Typed OM 为 `5%`。调整窗口后内边距不跟着变 |
| 2 | 钉住的像素不随视口、媒体查询变化（vw/vh 写法、按断点切换 `max-width`） | **属实**，但属于设计取舍 | `max-width:50vw` 读出来就是 `263px`。切回双语即可恢复 |
| 3 | 根元素上用 em 写的、会被继承的文本属性（`letter-spacing`、`word-spacing` 等），`et-tr` 继承到的是归零后的值 | **属实**（子会话当时没能确认，这次确认了） | 子元素自己设了 16px 字号，`letter-spacing` 仍从 `3.2px` 变成 `normal`（即 0），`word-spacing` 从 `16px` 变成 `0px`。原因是继承的是父元素的计算值（绝对长度），子元素的字号救不回来 |
| 4 | 根元素自身用 em 写的边框、圆角（以及 outline、box-shadow）归零 | **属实**，只影响外观 | `border-top-width` 从 `8px` 变成 `0px`，`border-radius` 从 `16px` 变成 `0px` |
| — | h1 宽度从 565px 缩到 445px；「跳至主要内容」的译文宽度为 0 | 不是问题 | 前者是 flex 项按内容收缩，后者是页面本来就视觉隐藏的跳转链接 |

## 修复安排

**小 PR `fix/translation-only-pins`**：处理第 1、1b、3 条。不必等 M3d，排在 i18n 第 2 批之后、冒烟 e2e 之前，赶在 v0.2.0 之前合入。

- **margin、padding 改读 Typed OM**（与 `width`/`height` 一样）：
  - 关键字（`auto`）不钉；
  - 百分比原样钉，不转成像素；
  - em/ch 等由 Typed OM 给出计算后的像素。
  - 老浏览器没有 `computedStyleMap` 时退回 `getComputedStyle`，即现状。
- **在 `et-tr` 上把可继承的文本间距设回去**：根元素归零前读出 `letter-spacing`、`word-spacing`，像 `--et-fs` 一样作为变量设回 `et-tr`。
  - 注意：`text-underline-offset` 在下划线样式里由我们自己用 `.28em` 设定，以 `et-tr` 自身字号计算，不受影响。
- **回归测试**：stub `computedStyleMap`，断言 margin 为 `auto` 时不写内联样式、百分比原样写入、`et-tr` 拿到字距变量。
- **体积**：page-runtime 目前 22.20/24KB，预计增加不到 0.1KB。

**第 2 条**：接受这个限制，不加 resize 监听。第 1、1b 条修好后，百分比和 `auto` 都能正常响应窗口变化，剩下的只有 vw/vh 写法和媒体查询切换，且切回双语即可恢复。在 `docs/plans/m2-page-translation.md` 的已知副作用里补一句即可。

**第 4 条**：暂不处理，等有真实站点的反馈再把相应属性加进 `PINNED`。border-width 有 4 个方向，体积成本较高。

**工程建议（真实浏览器测试）**：并入路线图的「冒烟 e2e」。Playwright（Node 版）加载构建产物，本地 fixture 页面增加以下写法：
- `max-width: Nch`
- `width: Nem`
- `flex: 0 0 Nem`
- `margin: 0 auto`
- `padding: N%`
- `letter-spacing: Nem`

断言仅看译文前后，译文根元素的宽度不塌陷、居中不偏移。启动参数带 `--use-mock-keychain --password-store=basic`；先作为可选命令，不放进 `npm run check`。
