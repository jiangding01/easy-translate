# Easy Translate 技术方案设计

本方案将旧插件1.0.109恢复出的功能与关键逻辑整理为现代TypeScript、WXT、React和Manifest V3的分模块实现依据。当前状态为设计稿、待实施，应用工程仍处于开发骨架阶段。

## 阅读顺序

先读[整体架构](00-architecture.md)，再读[通信与数据契约](13-protocols-and-data.md)，按功能进入模块，最后结合[实施与验收](14-implementation-and-validation.md)安排开发。每篇说明责任、输入输出、主要算法、配置、异常、生命周期、旧新行为差异和验收。

| 编号 | 设计文档 | 内容 |
| --- | --- | --- |
| 00 | [整体技术架构](00-architecture.md) | 执行环境、模块关系、目标架构、存储、权限、生命周期 |
| 01 | [翻译核心与供应商](01-translation-core.md) | 语言、各provider协议、Prompt、真实并发/速率、取消、去重、缓存 |
| 02 | [网页翻译与站点适配](02-page-translation.md) | DOM过滤分组、占位符、显示、恢复、动态页面、10站点 |
| 03 | [划词悬停与输入交互](03-interactions.md) | 选区、弹窗、朗读、输入、浮球、快捷键及竞态 |
| 04 | [截图与内容分享](04-capture-and-sharing.md) | 选区拼接、尺寸预算、源文快照、编辑、PNG/ZIP及PDF入口 |
| 05 | [YouTube字幕](05-youtube-subtitles.md) | 双世界桥、捕获、选轨、JSON3、窗口翻译、覆盖层、源SRT |
| 06 | [字幕阅读与文章模式](06-subtitle-reading.md) | 逐句调度、播放器恢复、50句/2并发文章、校验与回退、缓存 |
| 07 | [TikTok字幕与文稿](07-tiktok-captions.md) | 页面数据、受限抓取、首轨VTT、列表翻译、播放跟随、TXT |
| 08 | [配置与界面](08-configuration-and-ui.md) | 新schema、旧v18迁移、仓库、revision、popup/options/引导 |
| 09 | [账户与业务服务](09-account-and-services.md) | OAuth、回调、刷新、订阅、短码、Coco/文章客户端契约 |
| 10 | [专家、提示词与术语](10-experts-and-termbase.md) | 内置与自定义风格、Prompt组合、库/词条、URL匹配、JSON/CSV |
| 11 | [浏览器平台与反馈](11-browser-platform.md) | worker、菜单、commands、badge、截图、下载、TTS、反馈遥测 |
| 12 | [国际化与资源](12-i18n-and-assets.md) | 两套本地化、查词插值、语言映射、注入与资源、权限归属 |
| 13 | [协议与共享数据](13-protocols-and-data.md) | request/session/generation、错误、配置补丁、缓存身份、cue |
| 14 | [实施计划与验收](14-implementation-and-validation.md) | 批次依赖、完成门槛、测试层次、取消矩阵、待确认决策 |
| 15 | [兼容行为与设计决策](15-compatibility-and-decisions.md) | 交叉复核后关键事实与修复设计的集中对照 |

## 基线资料

- [旧默认配置](reference/legacy-default-config.json)保留schema18静态默认对象，供字段迁移核对。
- [语言和功能枚举](reference/legacy-enums.json)保留语言、显示样式和触发器等完整值域。枚举中的服务不自动代表已实现适配器。
- [十站点规则](reference/legacy-site-rules.json)保留完整内置选择器、强制渲染和属性规则，实施时逐站验证。
- [资料来源和归档映射](reference/material-mapping.md)说明旧文档内容如何进入本方案，以及压缩包恢复方式。

参考JSON中的`$undefined`、`$expression`或`$unresolved`是静态材料标记，不能作为新配置直接导入。新数据契约以本方案正文为准。

## 使用约定

“兼容基线”指安装包可确认的客户端事实，“设计决策”指重构时拟采用的行为，“待验证”指仍需真实浏览器、站点或服务端确认的项目。方案中的接口和伪代码是实现说明，后续每批再落地为源码及测试。

原始包、调查文档、交叉复核记录、证据、探针及分析脚本已统一备份到下载目录，校验信息见[归档记录](reference/archive.json)。本方案通过项目内相对链接查阅，关键逻辑和配置基线可直接使用。
