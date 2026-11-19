# M3d 动态页与站点规则：范围与拆分

> 状态：M3d 全部完成（B1 #54、B2 #55、D #56、C #57、E #58）。2026-11-19 用户批准（按 Fable 5.2 裁决与推荐选项）。各 PR 的方案与实施记录各自成文，本文只记范围、拆分与决定。

## 结论
M3d 收敛为 5 个独立可合并的小 PR，**不改常驻 content**（`content` 6.99 / 7.00 KB，预算不变）。全部改动落在按需 page-runtime（23.16 / 24 KB）；若超出，按实测把 page-runtime 预算提到 25 KB（用户已有条件同意，按需加载不影响首屏）。每个 PR 贴实测体积。

## 拆分（按顺序）
| 顺序 | PR | 范围 | 新文案 |
|---|---|---|---|
| 1 | B1 `fix/session-pinned-engine` | 会话开始时固定实际引擎（`engine = options.engine ?? config.translation.engine`，代码与 `session.ts` 注释一致）；面板与灵岛显示会话实际引擎（读配置前沿用默认作兜底）；「这次先用」切换照旧；`render.ts` 的 `setMode` 串行化，快速连切停在最后一次 | 无；已合并（#54） |
| 2 | B2 `fix/session-watch-before-scan` | 监听与配置订阅提前到初扫之前，扫描期间的脏元素缓存、扫完统一 rescan（Codex 第 4 条与「配置订阅晚于初扫」）；discover 把扫描期间追加的未访问子元素当边界（行内父元素除外），不并进未扫完容器的行内 run；e2e 第 19 条用隔离世界包装 `scheduler.yield` 做暂停点 | 无；已合并（#55） |
| 3 | D `feat/skip-ui-mock-regions` | page-runtime 内置站点表（hostname 后缀 → 排除选择器），首条 claude.dev 的 `.efx-fig`；通用规则：`role=img` 子树不翻且行内 `role=img` 原样保留；代码块工具栏不翻（`PRE` 或其外包容器的前兄弟 DIV/SPAN，两侧文本为空白，且含按钮、文字不超过 40 字，或为带工具栏类名的单个记号，HANDOFF 待处理 1 与 5）。方案与实施记录见 `docs/plans/skip-ui-mock-regions.md` | 无；已合并（#56） |
| 4 | C `feat/skipped-count` | 只统计超过 5000 字符的单元（URL、数字等噪声不计），`PageState.skipped`，灵岛与面板仅在大于 0 时显示（Codex 第 6 条） | 「N 段过长，未翻译」（需三语）；已合并（#57）。方案与实施记录见 `docs/plans/skipped-count.md` |
| 5 | E `fix/spa-route-cooldown` | e2e 覆盖 `pushState` 替换主内容等 11 种场景；修两处整页重扫冷却：自家删除的译文不算变动、URL 变化时冷却降到 1s；不加监听、不包 `pushState` | 无；已合并（#58）。方案与实施记录见 `docs/plans/spa-route-cooldown.md` |

## 用户已拍板的决定（2026-11-19）
1. 砍掉「从不翻译此站」：项目只在「总是翻译此站」时自动开始，它能拦的只有用户主动的快捷键、右键与面板。
2. Shadow DOM 移出 M3d，有真实站点反馈再单独立项。
3. 跳过计数做最小版，文案「N 段过长，未翻译」，仅在大于 0 时显示。灵岛最终只进读屏完成播报、段落自身显示占位，由用户委托 Fable 5.2 裁决（2026-11-19）。
4. page-runtime 超 24 KB 时按实测提到 25 KB。
5. 站点排除规则只内置、不开放编辑，仓库内硬编码站点条目（如 claude.dev）。
6. 设置页改默认引擎不影响已开会话，且不额外提示；灵岛与面板如实显示会话实际引擎。
7. 会话中途切引擎沿用「这次先用」：已译保留，未译与失败段改用新引擎，不重翻。
8. 装饰符号剥离与版面安全（定宽或裁剪容器不做行内追加）后移到 M3b，与手动「不翻译此区域」一起做。

## 不做
- MAIN world 内容脚本桥（包装 `pushState` / `attachShadow`）：每个页面留痕、计入常驻预算。
- 同源 iframe（仍只处理顶层 frame）。
- 按站点记住引擎或模式；用户可编辑站点规则；声明式站点适配 JSON（FluentRead 约 135 KB 内置）。
- 站点规则键仍为 origin，不改 eTLD+1（需要公共后缀表并迁移现有数据，没有收益）。

## 已知限制
- 只切 `hidden` 等属性的路由（标签页、`v-show`）不支持：监听不观察属性。
- 每次大范围变动都伴随 URL 变化的页面，整页重扫间隔固定 1s，不再逐级拉长。
- 连续换页间隔不到 1s 时，新页面最多再等约 1s。
- 「总是翻译此站」的站点首屏已是目标语言而未自动开始时，之后路由到外语页不会自动开始。
- 以后若必须在常驻层加逻辑，先瘦身（例如把 `pageIsInLanguage` 与 `sampleText` 挪进 page-runtime）再谈预算。

## 来源
调研与裁决：本文由主会话按调研事实与 Fable 5.2 裁决整理；Codex 评审核实见 `docs/reviews/2026-11-18-codex-review-verification.md`，核心发现核实见 `docs/reviews/2026-11-17-core-findings-verification.md`；待处理问题见 `HANDOFF.md` 第 5 节。
