# 更新日志

本文件记录 Easy Translate 的功能迭代过程。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

每完成一个批次（M0–M8）或一项用户可感知的改动，就在「未发布」下追加条目；正式发布时再把这些条目归入对应的版本号。条目分为：新增、变更、修复、移除、文档。

## [未发布]

### 文档
- 完成方案评审与重新规划，新增最终技术方案 `docs/reviews/2026-11-13-final-plan.md` 和 UI/UX 设计规范 `docs/reviews/2026-11-13-ui-ux-design.md`，「墨青纸感」视觉方向。
- 保留第一轮评审记录 `docs/reviews/2026-11-13-fable-design-review.md`，用于说明为什么偏离旧方案。
- 新增交接文档 `HANDOFF.md`，记录已拍板的决策、当前进度、下一步（M0）以及待实测的假设。
- 新增本更新日志。

### 变更（规划层面，尚未实现）
- 交付路线从原来的 A–L 共 12 个批次，调整为 M0–M8：先把全部翻译能力做完整（M0–M6），可选打磨放在 M7，账户相关放在 M8。
- 账户、订阅和 Coco 服务端接口暂不做；文章精翻改为基于用户自配 AI 供应商（BYOK），只针对字幕。
- `docs/design/00–15` 降级为功能参考，`DESIGN.md` 由 UI/UX 规范取代。

## [0.1.0] - 2026-11-08

### 新增
- 搭建基于 WXT、React 19、TypeScript 的 Chrome MV3 扩展骨架。
- 工具栏弹窗：检查当前网页，显示页面标题、页面声明的语言和通信状态。
- 设置页：保存目标语言，以及「双语对照 / 替换原文」显示偏好。
- 后台 Service Worker 与内容脚本之间的基础通信，本地偏好存储。
- `npm run check`：依次执行类型检查、生产构建和 manifest 资源校验。

### 文档
- 2026-11-12：整理分模块技术方案 `docs/design/00–15`，把前期逆向研究资料归档。

[未发布]: https://github.com/jiangding01/easy-translate/compare/7a03dbf...HEAD
[0.1.0]: https://github.com/jiangding01/easy-translate/commit/51cdccd
