# M3d PR-D：跳过界面示意区域与代码块工具栏

> 状态：已合并（#PRNUM，2026-11-19）。方案经 Opus 对抗式审查后修订，用户批准。总方案见 `docs/plans/m3d.md`（D 行，决定 5、8）；问题来源 `HANDOFF.md` 整页翻译待处理第 1、5 条（:114-130）。

## 问题（行号为 main `c54728e`）
1. **界面示意图被译乱**：claude.dev 博客 `spending-your-effort` 的 `figure.efx-fig` 是用 DOM 画的终端设置界面（等宽字体、flex 行、短标签），被翻译后标题变成「Settings设置」，标签行在末尾追加译文被挤出容器。实抓服务端 HTML 确认：`.efx-fig` 里没有 `role=img` 也没有 `figcaption`，4 个 `div.efx-slot[role=group]` 在服务端是空的，由客户端懒加载填充。通用启发式救不了它，只能靠站点规则；而且懒加载的内容走 rescan，rescan 的根可能已在 `.efx-fig` 里面，`discover` 不查根的祖先，只有 `session.ts:610` 的 `protectedAncestor` 能拦住，所以规则必须进 `isProtected`（`dom-rules.ts:139-151`）。
2. **代码块工具栏被翻译**：`<div class="ch"><span>CODE<span class="lang">Python</span></span><button>Copy</button></div><pre>` 中「CODE Python」被翻成「代码Python」，污染页面与 Inkmark 导出。实抓各站结构（调研记录见下表），需要新规则的都是「`PRE` 的前兄弟，或 `PRE` 外包一层容器的前兄弟」：

| 站点 | 结构 | 文本 | 现状 |
|---|---|---|---|
| claude.dev | `div.art-code > div.ch(span CODE + span.lang, button Copy) + pre` | 约 14 字 | 被翻 |
| MDN | `div.code-example > div.example-header > span.language-name"js"`，后接 `pre` | 2 | 被翻 |
| VitePress | `div.language-sh > button.copy + span.lang"sh" + pre` | 2-4 | 被翻 |
| Docusaurus | `div.codeBlockTitle"/src/…/X.js" + div.codeBlockContent > pre` | 20-40（路径） | 被翻 |
| Tailwind 文档 | `div.relative(div"Terminal" + button) + div > pre` | 8 | 被翻 |
| GitHub、Python docs、RTD | 外层 `div.highlight` 等带 `notranslate` | | 已跳过 |
| PaperMod、sphinx-copybutton | 复制按钮是 `BUTTON` | | 已跳过 |
| `pre` 内部的按钮 | `PRE` 在 `SKIP_TAGS`，整棵子树不进 | | 已跳过 |

3. **`role=img` 子树**：ARIA 规定 `role=img` 的子元素是呈现性的，文字由 `aria-label` 承担；claude.dev 的 `div.fig-draw[role=img]` 就是这样（文字在 `svg[aria-hidden]` 里，`figcaption` 在外面）。目前 `SKIP_ROLES`（`dom-rules.ts:115-123`）没有 `img`。

## 方案（只改 page-runtime 用到的 `dom-rules.ts` 与 `segment.ts`）
1. **`role=img` 跳过**：`SKIP_ROLES` 加 `'img'`。
   - 现状：行内的 `<span role="img" aria-label="rocket">🚀</span>`（React/MDX 博客常见）走 `segment.ts:59-67` 的成对标记 `<t0>🚀</t0>` 发送，表情保留；`render.ts:129` 的 inlineSpot 还可能把译文插进这个 span 里。
   - 加进 `SKIP_ROLES` 后，`segment.ts:48` 会把它丢掉，所以 `segment` 里新增 `isVerbatim(el) = VERBATIM_TAGS.has(el.tagName) || el.getAttribute('role') === 'img'`，替换该文件里所有 `VERBATIM_TAGS.has(...)` 判断：`role=img` 作为空标记 `<tN/>` 发送，回填时克隆原元素，与行内 `IMG`/`SVG` 一致；带 `aria-hidden="true"` 的同样克隆（与隐藏的行内 SVG 图标处理一致）。块级 `role=img` 在 `discover.ts:117` 按「跳过且非行内」成为边界，整块不翻。
2. **代码块工具栏**（新函数 `isCodeToolbar(el)`，在 `isProtected` 末尾调用）。按开销从低到高依次判断，同时满足才算：
   - 标签是 `DIV` 或 `SPAN`（白名单；`P`、标题、`LI`、`FIGCAPTION` 这类语义元素一律不算，说明文字与题注照常翻译）；
   - **后兄弟元素** `S = el.nextElementSibling` 是 `PRE`，或 `S.firstElementChild` 是 `PRE`（只看一层，指兄弟元素的第一个子元素）。实抓的 5 个站点工具栏都在代码块之前，不查前兄弟，避免误伤代码块后面的小节标题；
   - 紧挨的兄弟节点 `el.previousSibling`、`el.nextSibling` 若是文本节点则只含空白（`nextElementSibling` 不看文本节点，`<li>Install <span class="lang">Python</span> first:<pre>` 里的 span 否则会被误判，再被 `segment.ts:48` 从译文里丢掉）；
   - 二选一：
     - 含按钮：`el.querySelector('button')` 存在，且 `textContent` 去空白后不超过 40 字符（claude.dev、Tailwind）；
     - 只靠 class：`getAttribute('class')`（SVG 的 `className` 不是字符串）匹配 `/lang|filename|title|header|toolbar|copy/i`，且文本去首尾空白后**不含空白**（单个记号，如语言名、路径）、不超过 80 字符（MDN、VitePress、Docusaurus 路径）。Asciidoctor `div.listingblock > div.title`「Example 1. Configuring the server」、Bootstrap `div.card-header` 里的句子、`div.subtitle`、`div.copyright` 这类含空白的文字因此不受影响。
   - 不会误伤：`<p>Run:</p><pre>`、无 class 无按钮的 `<div>Output:</div><pre>`、`figcaption`、标题、代码块之后的元素。
   - 可能误伤（接受）：紧挨代码块之前、class 含上述词、文本是单个词的 `div`（如 `div.card-header`「Output」）。损失只是一个短词不翻。
3. **站点排除表**（决定 5：只内置、不开放编辑）：`dom-rules.ts` 内常量 `SITE_SKIPS: [hostname, selector][] = [['claude.dev', '.efx-fig']]`。`isProtected` 里按 `el.ownerDocument.defaultView?.location.hostname` 取当前主机，host 等于条目或以 `.条目` 结尾时 `el.matches(selector)`。按主机字符串缓存拼好的选择器（主机变了才重算），每个元素只多一次字符串比较。没有匹配条目的站点不调用 `matches`。
4. **体积约束**：常驻 content 经 `auto-start.ts` 引用了 `SKIP_TAGS`，但 `SKIP_ROLES` 与 `isProtected` 已被摇树摇掉（构建产物里没有 `toolbar` 字符串）。本 PR 不改 `SKIP_TAGS`，新代码只经 `isProtected` 与 `segment` 进入 page-runtime；提交前用 `check:size` 确认 content 仍是 6.99 KB。
5. **不影响**：划词翻译（`selection/extract.ts` 有自己的规则）；Inkmark DOM 契约（`docs/dom-contract.md` 只约定 `et-tr` 的标记语义，跳过区域只是不再插 `et-tr`）。

## 不做
- 「以等宽字体为主、大量短文本」的界面示意启发式（HANDOFF 候选 1 前半）：要读计算样式、阈值难定、误伤代码以外的表格与终端截图式排版，efx-fig 用站点表即可解决。
- 「`figure` 内只翻 `figcaption`」：会误伤 `figure > table`（WordPress 表格块）与 `figure > blockquote + figcaption`（引文），且救不了 efx-fig。
- 装饰符号剥离、定宽容器不做行内追加、手动「不翻译此区域」（决定 8，后移 M3b）。
- 站点表按路径匹配、用户可编辑（决定 5）。
- e2e：fixture 服务固定在 `127.0.0.1`，测不了按主机的站点表；工具栏与 `role=img` 是纯 DOM 判定，单测与 discover/session 用例已覆盖真实结构，不加 e2e。

## 测试
- **`dom-rules.test.ts`**：
  - `isProtected`：`role=img` 为真；
  - 工具栏正例：claude.dev、MDN、VitePress、Docusaurus（路径超过 40 字）、Tailwind 五种结构（用调研抓到的最小 DOM 片段）；
  - 工具栏反例（每条只破坏一个条件、其余条件都满足，变异才能变红）：`<h3 class="title">Setup</h3><pre>`（白名单）；`<div class="lang">py</div>` 在 `pre` 之后（只查后兄弟）；`<li>Install <span class="lang">Python</span> first:<pre>`（两侧文本）；含按钮且超过 40 字的 `div`；`<div class="title">Example 1. Configuring the server</div><div><pre>`（class 分支含空白）；`<p>Run:</p><pre>`、`<div>Output:</div><pre>`（无按钮无 class）；
  - 站点表：`window.happyDOM.setURL('https://www.claude.dev/')`（调研已实测可用）后 `.efx-fig` 受保护；`claude.dev` 同样；`notclaude.dev`、`example.com` 不受保护；vitest 的 happy-dom 默认 URL 为 `http://localhost:3000/`，用例在 `beforeEach` 保存原 `location.href`、`afterEach` 还原，避免污染同文件其他用例。
- **`segment.test.ts`**：段落里的 `<span role="img" aria-label="rocket">🚀</span>` 发送为空标记 `<t0/>`（改前是成对的 `<t0>🚀</t0>`，用这条区分），回填后译文里有克隆的表情元素；`aria-hidden="true"` 的同样克隆。
- **`discover.test.ts`**：claude.dev 的 `div.art-code`（`ch` + `pre`）与 VitePress 结构整体扫描，单元里没有「CODE」「Python」「sh」；`div[role=img]` 里直接放 HTML 文字（不放进 `svg`，否则改前也被跳过），不成单元，旁边的 `figcaption` 照常成单元。
- **`session.test.ts`**：主机为 claude.dev 时，rescan 一个懒加载填进 `.efx-fig .efx-slot` 的子树，不产生单元、不发请求（走 `protectedAncestor`）；主机为其他站点时照常翻译。
- **变异验证**：去掉 `SKIP_ROLES` 的 `img` → `role=img` 用例变红；`segment` 去掉 `isVerbatim` 的 `role=img` → 表情用例变红（丢失）；去掉 `isCodeToolbar` 调用 → 五个正例变红；去掉白名单 → `h3.title` 反例变红；改为也查前兄弟 → `pre` 之后的 `div.lang` 反例变红；去掉两侧文本检查 → `li` 反例变红；去掉 40 字上限 → 长文本反例变红；去掉「不含空白」→ Asciidoctor 反例变红；host 判断改成 `includes` → `notclaude.dev` 用例变红；去掉站点表 → session 懒加载用例变红。
- **命令**：`npm run check`（完整），`npm run test:e2e -- --retry=0`（确认无回归）。

## 体积
page-runtime 当前 23.27 / 24 KB，预计增加 0.3-0.4 KB，贴实测；不需要提预算。content 必须保持 6.99 KB。

## 文档
本方案（实施记录）；`docs/plans/m3d.md` D 行补 PR 号与「已合并」；`HANDOFF.md` 整页翻译待处理第 1、5 条状态（第 1 条：efx-fig 用站点表解决，等宽启发式与 figure 规则不做及原因；第 5 条：已解决）与阶段说明；CHANGELOG（修复：代码块上方的语言标签、文件名与复制按钮栏不再被翻译；`role="img"` 的图示内部文字不再被翻译，行内表情在译文中保留；claude.dev 的界面示意图不再被翻译）；检查 README 双语是否有相关描述。均写成合并后的终态。

## 回滚
revert 本 PR；只改 page-runtime 的跳过判定与分段，不涉及存储与数据。

## 分支
`feat/skip-ui-mock-regions`

## 实施记录（2026-11-19）
**实现**：
- `dom-rules.ts`：`SKIP_ROLES` 加 `img`；新增 `isCodeToolbar`、`SITE_SKIPS` 与按主机缓存的 `siteSelector`，都在 `isProtected` 末尾调用。
- `segment.ts`：`isVerbatim` 替换 3 处 `VERBATIM_TAGS.has`。

**与方案的差异**：
- `render.ts` 的 inlineSpot 未改：`role=img` 已被 `isSkipped` 跳过，行内译文的插入点落在末尾 `role=img` 表情之前（「原文 [译文🚀] 🚀」，原来会插进表情 span 内部），可接受。
- 测试用局部 `setURL` 辅助，因为 `window.happyDOM` 没有类型。
- 站点表缓存按主机字符串而不是按 Document，因为测试会在同一文档内换 URL。

**测试**：新增 24 条。`dom-rules.test` 17 条（`role=img` 1、工具栏正例 5、反例 7、站点表 4），`segment.test` 2 条，`discover.test` 3 条，`session.test` 2 条。修复前对比：换回 main 版 `dom-rules.ts` 与 `segment.ts` 后，14 条新用例变红，反例与其他主机用例本来就绿。

**变异验证**：方案列出的 10 条均变红；另加 1 条：删掉 rescan 的 `protectedAncestor` 检查后，claude.dev 懒加载用例变红。

**体积**：page-runtime 23.27 到 23.63 KB（上限 24），content 6.99 KB 不变；构建产物 `content.js` 不含 `efx-fig`、`filename`。

**验证**：`npm run check` 退出码 0（1595 个用例）；e2e 全套 `--retry=0` 无失败（41 通过、2 跳过）。

**check 结论**：第 1 轮（Opus 审）无阻断问题。2 条应改已修：懒加载用例没走到 `protectedAncestor`；`afterEach` 还原成 `about:blank` 会污染后续用例。3 条建议中，「只含行内 `role=img` 或行内 `code` 的块会发出只有占位符的请求」是既有问题，记入 HANDOFF；另两条（inlineSpot 插入点、按 Document 缓存主机）不改，原因见上。第 2 轮只审修复增量，无新问题。
