# 译屿（Islet Translate）文档中心

> 2026-11-13 起，权威方案改为 [最终技术方案](reviews/2026-11-13-final-plan.md) 和 [UI/UX 设计规范](reviews/2026-11-13-ui-ux-design.md)。`design/` 下的文档降级为功能细节参考；两者冲突时，以权威方案和[交接文档](../HANDOFF.md)为准。

项目使用 TypeScript、React、WXT 和 Manifest V3 开发。完整模块索引见[技术方案设计](design/README.md)，界面约定见[设计规范](../DESIGN.md)。

## 从这里开始

| 文档 | 适用场景 |
| --- | --- |
| [整体架构](design/00-architecture.md) | 了解执行环境、模块职责及数据流 |
| [通信与共享数据](design/13-protocols-and-data.md) | 确定跨模块接口、任务身份和状态 |
| [实施与验收](design/14-implementation-and-validation.md) | 选择开发批次并核对交付门槛 |

## 按功能查阅

| 功能 | 方案 |
| --- | --- |
| 翻译服务 | [供应商、调度与缓存](design/01-translation-core.md) |
| 网页阅读 | [DOM翻译与站点适配](design/02-page-translation.md) |
| 交互操作 | [划词、悬停与输入](design/03-interactions.md) |
| 截图分享 | [截图、Markdown与导出](design/04-capture-and-sharing.md) |
| 视频字幕 | [YouTube](design/05-youtube-subtitles.md)、[阅读与文章模式](design/06-subtitle-reading.md)、[TikTok](design/07-tiktok-captions.md) |
| 配置界面 | [配置、弹窗、设置与引导](design/08-configuration-and-ui.md) |
| 账户服务 | [鉴权、会员与业务接口](design/09-account-and-services.md) |
| 翻译定制 | [专家、提示词与术语库](design/10-experts-and-termbase.md) |
| 浏览器能力 | [菜单、快捷键、下载、朗读与反馈](design/11-browser-platform.md) |
| 国际化资源 | [语言、词典、静态资源与权限](design/12-i18n-and-assets.md) |
| 设计取舍 | [兼容行为与设计决策](design/15-compatibility-and-decisions.md) |

方案中的业务能力处于待实施状态。当前已交付能力和开发命令见[项目 README](../README.md)。
